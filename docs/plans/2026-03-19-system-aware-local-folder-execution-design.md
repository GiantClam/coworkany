# System-Aware Local Folder Execution Design

**Goal:** Make CoworkAny reliably execute local file-management tasks such as "organize Downloads images" without relying on prompt phrasing, while preserving least-privilege security and explicit user approval for host-folder access.

**Status:** Proposed implementation design

**Primary references:**

- OpenClaw treats prompt guidance as advisory and keeps enforcement in sandbox, workspace policy, and approvals.
- OpenClaw uses explicit execution approvals and least-privilege tool profiles instead of trusting the model to self-limit.
- Nanobot exposes explicit workspace restrictions in host configuration rather than relying on model interpretation.
- MCP security guidance recommends progressive least privilege and explicit grants for local capabilities.
- Tauri/macOS guidance requires capability scoping plus dialog-driven access for user-selected files/folders; persistent non-workspace access on macOS should use security-scoped bookmark patterns.

Reference URLs:

- https://docs.openclaw.ai/concepts/system-prompt
- https://docs.openclaw.ai/gateway/security
- https://docs.openclaw.ai/tools/exec-approvals
- https://github.com/nanobot-ai/nanobot
- https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- https://v2.tauri.app/security/permissions/
- https://v2.tauri.app/plugin/dialog/
- https://github.com/tauri-apps/tauri/issues/3716

---

## Problem Statement

Today CoworkAny fails local system-folder tasks for three structural reasons:

1. The work-request layer does not resolve natural-language folder references such as `Downloads`, `Desktop`, `Documents`, or their Chinese equivalents into OS-specific absolute paths.
2. The execution layer gives the model inconsistent signals: built-in file tools can technically handle absolute paths, but the prompt and toolpack metadata say filesystem actions are restricted to the workspace.
3. Built-in tools do not pass through the same effect-gated approval path as MCP tools, so there is no trusted approval flow for host-folder access even if the model chooses the right tool.

The direct result is that the model falls back to "copy this shell script into your terminal" instead of forming a concrete execution plan with explicit tools, paths, and approvals.

This is a control-plane gap, not a prompt-tuning gap.

---

## Design Principles

1. `Policy over prompt`

The model may suggest actions, but folder resolution, approval requirements, allowed scopes, and execution pathways must be enforced by runtime code.

2. `System-aware, not user-spoon-fed`

The user should not need to type `/Users/name/Downloads`. CoworkAny should infer well-known directories from the current platform and locale.

3. `Workspace remains default boundary`

Workspace-only access stays the baseline. Access to host folders such as `Downloads` is a separate capability path with explicit grants.

4. `Progressive least privilege`

Host-folder access should be granted narrowly by folder class and resolved path, with session-scoped approval by default and persistent approval only when the platform supports safe persistence.

5. `Deterministic workflow for recurring local tasks`

For common host-file tasks, CoworkAny should use a structured workflow rather than letting the model improvise tool selection from scratch.

---

## Target User Experience

Example request:

`整理 Downloads 文件夹下的图片文件`

Expected runtime behavior:

1. The control plane recognizes `Downloads` as a well-known system folder on the current OS.
2. CoworkAny resolves the folder to the concrete path for the active user.
3. CoworkAny builds a concrete execution plan:
   - discover candidate image files
   - propose categorization strategy
   - request access to `Downloads`
   - execute moves
   - verify counts and results
4. The desktop UI shows an approval dialog that is specific and actionable:
   - folder: `~/Downloads`
   - reason: `Organize image files into categorized subfolders`
   - actions: read directory, create folders, move files
5. After approval, CoworkAny executes the plan and returns a structured summary with verification evidence.

The model is still useful, but only inside this governed flow.

---

## High-Level Architecture

Add a new control-plane slice for host-folder execution:

1. `WellKnownFolderResolver`
2. `LocalTaskIntentClassifier`
3. `HostAccessGrantManager`
4. `LocalWorkflowRegistry`
5. `Policy-gated builtin tool executor`

### Layering

1. `Natural language request`
2. `Work request normalization`
3. `Well-known folder resolution`
4. `Workflow planning`
5. `Permission and grant check`
6. `Tool execution via gated builtin executor`
7. `Verification and presentation`

This keeps responsibility split cleanly:

- `Analyzer` decides what the user wants.
- `Resolver` decides which real folder that means on the current system.
- `Grant manager` decides whether access is allowed.
- `Workflow` decides the deterministic execution recipe.
- `Model` fills in flexible details inside that recipe.

---

## New Runtime Contracts

### 1. Well-Known Folder Reference

```ts
type WellKnownFolderId =
  | 'downloads'
  | 'desktop'
  | 'documents'
  | 'pictures'
  | 'movies'
  | 'music'
  | 'home';

type ResolvedFolderReference = {
  kind: 'well_known_folder';
  folderId: WellKnownFolderId;
  sourcePhrase: string;
  resolvedPath: string;
  os: 'macos' | 'windows' | 'linux';
  confidence: number;
};
```

### 2. Local Task Intent

```ts
type LocalTaskIntent =
  | 'organize_files'
  | 'move_files'
  | 'rename_files'
  | 'delete_files'
  | 'inspect_folder'
  | 'deduplicate_files'
  | 'unknown';

type LocalTaskPlanHint = {
  intent: LocalTaskIntent;
  targetFolder?: ResolvedFolderReference;
  fileKinds: string[];
  preferredTools: string[];
  preferredWorkflow?: string;
  requiresHostAccessGrant: boolean;
};
```

### 3. Host Access Grant

```ts
type HostAccessGrant = {
  id: string;
  folderId?: WellKnownFolderId;
  resolvedPath: string;
  access: Array<'read' | 'write' | 'move' | 'delete'>;
  scope: 'once' | 'session' | 'persistent';
  platformMechanism: 'session-memory' | 'security-scoped-bookmark' | 'path-allowlist';
  createdAt: string;
  expiresAt?: string;
};
```

### 4. Builtin Effect Context

```ts
type BuiltinEffectContext = {
  taskId: string;
  toolName: string;
  targetPath?: string;
  targetPaths?: string[];
  operation: 'read' | 'write' | 'create' | 'move' | 'delete' | 'exec';
  reasoning: string;
  resolvedFolder?: ResolvedFolderReference;
};
```

---

## Module Design

### 1. `sidecar/src/system/wellKnownFolders.ts`

Responsibilities:

- Map localized phrases to canonical folder ids.
- Resolve the canonical folder id to an absolute path for the current OS.
- Keep platform-specific resolution out of prompt text.

Implementation details:

- macOS and Linux use `os.homedir()` plus conventional folder names.
- Windows resolves from environment variables or known-folder APIs exposed by desktop IPC.
- Phrase matching covers English and Chinese:
  - `downloads`, `download`
  - `下载`, `下载目录`, `下载文件夹`
  - `desktop`, `桌面`
  - `documents`, `文档`
  - `pictures`, `图片`, `图片文件夹`

Future extension:

- Add localization packs or user-customized aliases.

### 2. `sidecar/src/orchestration/localTaskIntent.ts`

Responsibilities:

- Detect when a task is about host folders and local filesystem operations.
- Extract file kinds and common operations from natural language.

Rules:

- If text contains a well-known folder plus verbs like `整理`, `分类`, `移动`, `归档`, `删除`, `重命名`, `去重`, mark it as local task intent.
- Populate `preferredTools` and `preferredWorkflow`.
- Avoid asking the model to infer these basics.

### 3. `sidecar/src/orchestration/workRequestAnalyzer.ts`

Changes:

- Extend `TaskDefinition` creation to include `preferredTools`, `preferredWorkflow`, and `resolvedTargets`.
- Attach `LocalTaskPlanHint` when a host-folder task is detected.
- Replace empty `preferredTools` with concrete defaults.

Example transformation:

Input:

`整理 Downloads 文件夹下的图片文件`

Structured task:

```json
{
  "objective": "Organize image files in the user's Downloads folder",
  "preferredTools": ["list_dir", "run_command"],
  "preferredWorkflow": "organize-downloads-images",
  "resolvedTargets": [
    {
      "kind": "well_known_folder",
      "folderId": "downloads",
      "resolvedPath": "/Users/beihuang/Downloads"
    }
  ]
}
```

### 4. `sidecar/src/orchestration/localWorkflowRegistry.ts`

Register deterministic workflows for common host-folder tasks.

Initial workflows:

1. `organize-downloads-images`
2. `inspect-downloads-images`
3. `deduplicate-downloads-images`

Each workflow declares:

- required grant type
- default read/write operations
- deterministic execution steps
- verification steps

Example workflow shape:

```ts
type LocalWorkflow = {
  id: string;
  matchIntent: LocalTaskIntent;
  requiredAccess: Array<'read' | 'write' | 'move'>;
  plan: Array<{
    step: string;
    tool: string;
    reasoning: string;
  }>;
};
```

### 5. `sidecar/src/security/hostAccessGrantManager.ts`

Responsibilities:

- Decide whether a resolved host-folder action needs approval.
- Check existing grants.
- Persist and expire grants.
- Bridge persistent access on macOS through desktop support.

Behavior:

- Workspace paths do not use this manager.
- Host-folder paths do.
- Grant lookup is based on:
  - folder id
  - resolved path
  - requested operation set
  - scope

### 6. `sidecar/src/tools/builtinExecutor.ts`

Create a dedicated executor for builtin tools that mirrors the MCP gateway policy flow.

Responsibilities:

- Inspect builtin tool effects before `handler(...)`.
- Build `EffectRequest` using builtin metadata and resolved targets.
- Send all nontrivial host-path operations through `PolicyBridge`.

This is the missing symmetry today.

---

## Approval Model

### Current Gap

MCP tools already pass through `PolicyBridge`, but builtin tools execute directly.

### Proposed Fix

Introduce `executeBuiltinToolWithPolicy(...)`.

Pseudo-flow:

```ts
resolve builtin tool
infer builtin effect context
if target path is inside workspace:
  apply workspace policy
else:
  classify as host-folder access
  request grant if needed
request effect approval through PolicyBridge
if approved:
  execute handler
else:
  stop with structured denial
```

### Effect Request Granularity

Do not show generic approvals like `filesystem:write`.

Show:

- path: `/Users/beihuang/Downloads`
- folder class: `downloads`
- operation: `read directory + create categorized folders + move image files`
- source tool or workflow: `organize-downloads-images`

This matches the OpenClaw principle that approvals should bind real request context, not vague tool classes.

---

## Desktop and Tauri Design

### New Desktop Commands

Add Tauri commands for system-aware folder access:

1. `resolve_well_known_folder(folderId)`
2. `request_host_folder_access(request)`
3. `persist_host_folder_bookmark(path)`
4. `restore_host_folder_bookmark(bookmarkId)`
5. `revoke_host_folder_grant(grantId)`

### macOS Strategy

1. Use resolved folder ids for discovery.
2. When host-folder access is requested, present a system-backed folder authorization path.
3. For persistent access, store a security-scoped bookmark.
4. Start and stop security-scoped access around actual execution.

Rationale:

- This aligns with macOS sandbox expectations.
- It avoids pretending path strings alone are enough for long-lived non-workspace access.

### Non-macOS Strategy

- Session scope: store resolved path grant in app data.
- Persistent scope: use explicit path allowlist record plus platform-native access behavior where available.

### Tauri Capability Changes

Keep default capability narrow.

Do not globally allow broad `fs:*` access.

Instead:

- continue using policy-based host access
- add dialog capability for explicit folder selection if required by platform
- keep persistent access opt-in and path-specific

---

## Execution Path for "Organize Downloads Images"

### State Machine

1. `analyze_request`
2. `resolve_well_known_folder`
3. `classify_local_task_intent`
4. `select_workflow`
5. `check_grant`
6. `ask_approval_if_needed`
7. `list_candidates`
8. `plan_folder_layout`
9. `execute_moves`
10. `verify_results`
11. `present_summary`

### Concrete Tool Path

Recommended default implementation:

1. `list_dir` to discover files in `Downloads`
2. `run_command` or dedicated `move_files` builtin to perform deterministic moves
3. `list_dir` and verification command to confirm results

Longer-term preferred tooling:

- add dedicated builtin file operation tools:
  - `create_directory`
  - `move_file`
  - `batch_move_files`

This reduces shell dependence and makes approvals more precise.

### Why Not Pure `run_command`

Pure shell execution is flexible but opaque for policy and UX.

Best practice is:

- use structured builtin file tools where possible
- use `run_command` only as a controlled fallback

This mirrors OpenClaw's bias toward explicit tool profiles and bounded execution surfaces.

---

## Prompt Changes

Prompt changes should be minimal and only reinforce the runtime architecture.

Replace misleading guidance:

- old: "Use file tools for working with files in the workspace."

With:

- new: "Use file tools for workspace files by default. For system folders such as Downloads, Desktop, Documents, and Pictures, rely on the structured resolved target and workflow selected by the control plane. Do not refuse merely because the user did not provide an absolute path."

This prompt is no longer the primary fix. It becomes a consistency note.

---

## Data Persistence

Store host-folder grants under app data:

```json
{
  "grants": [
    {
      "id": "grant_123",
      "folderId": "downloads",
      "resolvedPath": "/Users/beihuang/Downloads",
      "access": ["read", "write", "move"],
      "scope": "session",
      "platformMechanism": "session-memory",
      "createdAt": "2026-03-19T10:00:00Z"
    }
  ]
}
```

macOS persistent entries additionally store bookmark data outside general session JSON, ideally in a dedicated secure store file owned by the desktop runtime.

---

## Testing Strategy

### Unit Tests

1. folder phrase resolution
2. multilingual phrase matching
3. local task intent classification
4. workflow selection
5. grant matching and expiration
6. builtin effect request generation

### Integration Tests

1. `整理 Downloads 文件夹下的图片文件` resolves to host-folder task with `downloads`
2. builtin tool execution emits `EFFECT_REQUESTED`
3. denied grant blocks execution before handler
4. approved grant allows execution and records audit event
5. macOS bookmark restoration path is invoked for persistent grants

### Acceptance Tests

1. User asks without absolute path:
   - system resolves Downloads automatically
   - approval dialog appears
   - task executes after approval
2. User repeats the task in same session:
   - no redundant approval if session grant still valid
3. User revokes grant:
   - next run requests approval again

### Regression Tests

1. Workspace-only coding tasks remain unchanged
2. MCP approval flow remains unchanged
3. Prompt no longer causes "I cannot access your local filesystem" for well-known folder tasks

---

## Rollout Plan

### Phase 1: Control Plane Resolution

- add well-known folder resolver
- add local task intent classifier
- extend work request contract
- add unit tests

Outcome:

- CoworkAny stops treating `Downloads` as vague text

### Phase 2: Builtin Policy Gating

- add builtin executor wrapper
- route builtin file and command tools through `PolicyBridge`
- emit effect events for builtin execution

Outcome:

- approvals become real and visible

### Phase 3: Host Access Grants

- add grant persistence
- add desktop UI for host-folder approvals
- add session and persistent scopes

Outcome:

- repeat tasks become ergonomic without broadening defaults

### Phase 4: Dedicated File Tools

- add structured `move_file` and `batch_move_files`
- reduce reliance on `run_command`

Outcome:

- better auditability and safer execution

### Phase 5: macOS Persistent Access

- implement bookmark-backed persistent grants
- add restore and revoke flows

Outcome:

- system-folder automation survives restart on macOS where permitted

---

## Why This Is the Best-Fit Approach

This design is the best fit for CoworkAny because it combines the strongest ideas from the referenced systems without copying their assumptions blindly:

1. From OpenClaw:
   - prompt is not the security boundary
   - approvals bind concrete action context
   - least privilege stays the default

2. From Nanobot:
   - workspace and host access must be explicit runtime constructs
   - host configuration, not model prose, should define file reach

3. From Tauri and macOS practice:
   - user-selected host-folder access should use platform-native authorization flows
   - persistent non-workspace access needs stronger OS-aware handling than a raw path string

4. For CoworkAny specifically:
   - current architecture already has the right pieces: `workRequestAnalyzer`, `PolicyBridge`, `EffectRequest`, desktop confirmation UI
   - the missing piece is wiring them together around a first-class host-folder execution model

This gives CoworkAny a system-aware, policy-driven, user-approvable path for local automation without weakening the workspace-default safety model.

---

## Implementation Checklist

- Extend `TaskDefinition` with resolved host targets and workflow hints.
- Add well-known folder resolver for macOS, Windows, and Linux.
- Add local filesystem intent classifier.
- Add local workflow registry with `organize-downloads-images`.
- Add builtin executor wrapper that emits `EffectRequest`.
- Route builtin file and command tools through `PolicyBridge`.
- Add host access grant manager.
- Add desktop commands for resolving and granting host-folder access.
- Add macOS bookmark-backed persistent grant support.
- Update prompt wording to reflect the new runtime model.
- Add unit, integration, and acceptance coverage.

