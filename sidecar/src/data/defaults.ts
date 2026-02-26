import { ClaudeSkillManifest, ToolpackManifest } from '../protocol';

// Extend Protocol manifest to include storage-specific fields
interface BuiltinSkillManifest extends ClaudeSkillManifest {
    directory: string;
    /** Embedded SKILL.md content for builtins (no filesystem dependency) */
    content: string;
    /** Trigger phrases for auto-activation */
    triggers?: string[];
}

// ============================================================================
// Builtin Skill Content (Embedded)
// ============================================================================

const SKILL_CODING_STANDARDS = `---
name: coding-standards
description: Common coding standards and readability guidelines.
---

# Coding Standards

## Overview
Follow consistent coding standards to improve readability and maintainability.

## Key Principles
1. **Naming**: Use descriptive, intention-revealing names.
2. **Functions**: Keep functions small (< 20 lines). Single responsibility.
3. **Comments**: Code should be self-documenting. Comment "why", not "what".
4. **Formatting**: Consistent indentation. Logical grouping.
5. **Error Handling**: Handle errors explicitly. Don't swallow exceptions.

## Language-Specific
- **TypeScript**: Prefer strict mode. Use types, avoid \`any\`.
- **Python**: Follow PEP 8. Use type hints.
- **Rust**: Use clippy. Handle Result/Option explicitly.
`;

const SKILL_FRONTEND_PATTERNS = `---
name: frontend-patterns
description: Common patterns for React and Next.js frontend development.
---

# Frontend Patterns

## React Best Practices
1. **Components**: Small, focused, reusable.
2. **State**: Lift state up. Use context sparingly.
3. **Effects**: Cleanup side effects. Avoid memory leaks.
4. **Props**: Destructure early. Validate with TypeScript.

## Next.js Patterns
1. **App Router**: Use server components by default.
2. **Data Fetching**: Fetch on server. Use \`use\` for client.
3. **Routing**: File-based. Use dynamic segments.
4. **API Routes**: Keep thin. Delegate to services.
`;

const SKILL_BACKEND_PATTERNS = `---
name: backend-patterns
description: Common patterns for API, DB, and Caching backend development.
---

# Backend Patterns

## API Design
1. **REST**: Resource-oriented. Use HTTP methods correctly.
2. **Error Responses**: Structured. Include error codes.
3. **Validation**: Validate input at boundaries.
4. **Pagination**: Cursor-based for large datasets.

## Database
1. **Queries**: Use parameterized queries. Avoid N+1.
2. **Transactions**: Explicit boundaries. Handle rollback.
3. **Migrations**: Version controlled. Reversible.

## Caching
1. **Strategy**: Cache expensive operations.
2. **Invalidation**: Time-based or event-driven.
3. **Keys**: Consistent naming scheme.
`;

const SKILL_TDD_WORKFLOW = `---
name: tdd-workflow
description: Use when implementing any feature or bugfix, before writing implementation code. Enforces RED-GREEN-REFACTOR cycle.
triggers:
  - 实现功能
  - 修复bug
  - fix bug
  - implement
  - new feature
  - bugfix
  - 写代码
---

# Test-Driven Development (TDD)

## The Iron Law
\`\`\`
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
\`\`\`

Write code before the test? **Delete it. Start over.**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

**Violating the letter of the rules is violating the spirit of the rules.**

## Red-Green-Refactor

1. **RED** — Write failing test
2. **Verify RED** — Watch it fail (**MANDATORY, never skip**)
3. **GREEN** — Write minimal code to pass
4. **Verify GREEN** — Watch it pass
5. **REFACTOR** — Clean up (keep tests green)
6. **Repeat**

### RED — Write Failing Test
- One behavior per test
- Clear, intention-revealing name
- Real code (no mocks unless unavoidable)

### Verify RED — Watch It Fail (MANDATORY)
- Test fails (not errors)
- Failure message is expected
- Fails because feature missing (not typos)
- **Test passes?** You're testing existing behavior. Fix test.

### GREEN — Minimal Code
Write the **simplest** code to pass the test.
Don't add features, refactor other code, or "improve" beyond the test.

### REFACTOR — Clean Up
After green only. Remove duplication, improve names, extract helpers.
Keep tests green. Don't add behavior.

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test hard = skip test" | Hard to test = hard to use. Listen to the test. |
| "TDD will slow me down" | TDD faster than debugging. |
| "Existing code has no tests" | You're improving it. Start now. |
| "Just this once" | No exceptions. This IS the rationalization. |

## Red Flags — STOP and Start Over

- Code written before test
- Test passes immediately
- Can't explain why test failed
- Tests "to be added later"
- Rationalizing "just this once"

**All of these mean: Delete code. Start over with TDD.**

## Verification Checklist
- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Output pristine (no errors, warnings)
`;

const SKILL_SECURITY_REVIEW = `---
name: security-review
description: Basic security checklist and review guidelines.
---

# Security Review

## Input Validation
- Validate all user input.
- Use allowlists, not blocklists.
- Sanitize output for context (HTML, SQL, etc.).

## Authentication
- Use established libraries (no custom crypto).
- Store passwords hashed (bcrypt, argon2).
- Enforce strong password policies.

## Authorization
- Check permissions at every access point.
- Deny by default.
- Log access attempts.

## Data Protection
- Encrypt sensitive data at rest.
- Use TLS for data in transit.
- Minimize data collection.
`;

const SKILL_VERIFICATION_LOOP = `---
name: verification-loop
description: Use before claiming ANY work is complete, fixed, or passing. Evidence before assertions always. Prevents false completion claims.
triggers:
  - 完成
  - 已修复
  - done
  - fixed
  - passes
  - all tests pass
  - 验证
---

# Verification Before Completion

## The Iron Law
\`\`\`
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
\`\`\`

Claiming work is complete without verification is dishonesty, not efficiency.
**Violating the letter of this rule is violating the spirit of this rule.**

## The Gate Function
\`\`\`
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
\`\`\`

## Common Claims — What Each Requires

| Claim | Requires | NOT Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, "looks good" |
| Bug fixed | Test original symptom: passes | "Code changed, assumed fixed" |
| Task complete | Plan steps all marked completed | "Tests pass" (≠ requirements met) |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist verified | "Tests passing" |

## Red Flags — STOP Before Continuing

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!")
- About to commit/push/PR without running tests
- Trusting a tool's success report without independent verification
- Relying on partial verification
- Thinking "just this once"
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler ≠ tests |
| "Agent said success" | Verify independently |
| "Partial check is enough" | Partial proves nothing |
| "The code looks correct" | Looking ≠ running |
| "I already tested manually" | Manual testing has no record. Can't re-run. |

## Verification Patterns

**Tests:**
✅ [Run test command] → [See: 34/34 pass] → "All tests pass"
❌ "Should pass now" / "Looks correct"

**Build:**
✅ [Run build] → [See: exit 0] → "Build passes"
❌ "Linter passed" (linter doesn't check compilation)

**Bug fix:**
✅ [Write regression test] → [Verify it fails] → [Apply fix] → [Verify it passes]
❌ "I've fixed the bug" (without running the test)

**Requirements:**
✅ Re-read plan → Create checklist → Verify each item → Report gaps or completion
❌ "Tests pass, phase complete" (tests ≠ requirements)
`;

const SKILL_ITERATIVE_RETRIEVAL = `---
name: iterative-retrieval
description: Iterative context retrieval strategy.
---

# Iterative Retrieval

## Strategy
1. **Start Broad**: Initial search with general terms.
2. **Refine**: Use results to narrow search.
3. **Verify**: Confirm retrieved context is relevant.
4. **Iterate**: Repeat until sufficient context gathered.

## When to Use
- Exploring unfamiliar codebases.
- Finding related code patterns.
- Gathering context for complex changes.

## Anti-Patterns
- Single-shot searches.
- Ignoring low-confidence results.
- Over-relying on exact matches.
`;

const SKILL_CONTINUOUS_LEARNING = `---
name: continuous-learning-v2
description: Automated summarization and habit formation.
---

# Continuous Learning

## Summarization
- After completing tasks, summarize learnings.
- Document patterns that worked.
- Note anti-patterns encountered.

## Habit Formation
- Identify recurring workflows.
- Automate repetitive steps.
- Build mental models of the codebase.

## Knowledge Transfer
- Write clear documentation.
- Share insights with team.
- Update READMEs and guides.
`;

const SKILL_BRAINSTORMING = `---
name: brainstorming
description: Use before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores intent, requirements and design before implementation.
triggers:
  - 设计
  - 方案
  - design
  - 架构
  - architecture
  - 需求
  - requirements
  - plan feature
  - 新功能
---

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs through collaborative dialogue.
Start by understanding the current project context, then ask questions one at a time.

## The Process

**Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
- Ask questions ONE AT A TIME to refine the idea
- Prefer multiple choice questions when possible
- Focus on: purpose, constraints, success criteria

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Lead with your recommended option and explain why
- Apply YAGNI ruthlessly — remove unnecessary features from all designs

**Presenting the design:**
- Present design in sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify

## After the Design

**Documentation:**
- Write the validated design to .coworkany/plans/YYYY-MM-DD-<name>-design.md
- Use plan_step to track the design phases

**Implementation (if continuing):**
- Ask: "Ready to set up for implementation?"
- Use the writing-plans approach to create detailed implementation plan

## Key Principles

- **One question at a time** — Don't overwhelm with multiple questions
- **Multiple choice preferred** — Easier to answer than open-ended
- **YAGNI ruthlessly** — Remove unnecessary features from all designs
- **Explore alternatives** — Always propose 2-3 approaches before settling
- **Incremental validation** — Present design in sections, validate each
`;

const SKILL_WRITING_PLANS = `---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code. Creates bite-sized implementation plans.
triggers:
  - 实现计划
  - implementation plan
  - 开始实现
  - start implementing
  - 拆分任务
  - break down
  - 计划实施
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context.
Document everything: which files to touch, code, testing, how to verify.
Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

## Plan Document Header

Every plan MUST start with:
\\\`\\\`\\\`markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence describing what this builds]
**Architecture:** [2-3 sentences about approach]
**Tech Stack:** [Key technologies/libraries]
\\\`\\\`\\\`

## Task Structure

\\\`\\\`\\\`markdown
### Task N: [Component Name]

**Files:**
- Create: exact/path/to/file.py
- Modify: exact/path/to/existing.py:123-145
- Test: tests/exact/path/to/test.py

**Step 1: Write the failing test**
[complete test code]

**Step 2: Run test to verify it fails**
Run: pytest tests/path/test.py::test_name -v
Expected: FAIL

**Step 3: Write minimal implementation**
[complete implementation code]

**Step 4: Run test to verify it passes**
Expected: PASS

**Step 5: Commit**
\\\`\\\`\\\`

## Remember

- **Exact file paths always** — no ambiguity
- **Complete code in plan** — not "add validation"
- **Exact commands with expected output**
- **DRY, YAGNI, TDD, frequent commits**
- Save plans to .coworkany/plans/YYYY-MM-DD-<name>.md
- Use plan_step to persist the plan to task_plan.md for tracking

## Execution Handoff

After saving the plan, start execution:
- Mark each step in plan_step as you complete it
- Use log_finding to record discoveries
- Follow TDD: test first, verify fail, implement, verify pass
`;

const SKILL_SYSTEMATIC_DEBUGGING = `---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes. 4-Phase root cause process with 3-Fix Rule.
triggers:
  - bug
  - error
  - 报错
  - 失败
  - failed
  - not working
  - 不工作
  - 崩溃
  - crash
  - debug
  - 调试
---

# Systematic Debugging

## The Iron Law
\\\`\\\`\\\`
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
\\\`\\\`\\\`

Random fixes waste time and create new bugs. Quick patches mask underlying issues.
If you haven't completed Phase 1, you CANNOT propose fixes.

## When to Use

Use for ANY technical issue: test failures, bugs, unexpected behavior, performance problems, build failures, integration issues.

**Use this ESPECIALLY when:**
- Under time pressure (systematic = faster than guessing)
- "Just one quick fix" seems obvious (that's the trap)
- You've already tried multiple fixes (stop trying, start investigating)
- Previous fix didn't work (you probably fixed a symptom, not root cause)

## The Four Phases

### Phase 1: Root Cause Investigation (BEFORE any fix)

1. **Read Error Messages Carefully** — Don't skip errors/warnings. Read stack traces completely.
2. **Reproduce Consistently** — Can you trigger it reliably? If not reproducible → gather more data, don't guess.
3. **Check Recent Changes** — Git diff, recent commits, new dependencies, config changes.
4. **Gather Evidence in Multi-Component Systems** — Add diagnostic logging at each component boundary. Run once to see WHERE it breaks.
5. **Trace Data Flow** — Where does the bad value originate? Keep tracing backward until you find the source. Fix at source, not symptom.

### Phase 2: Pattern Analysis

1. **Find Working Examples** — Locate similar working code in same codebase.
2. **Compare Against References** — Read reference implementation COMPLETELY (don't skim).
3. **Identify Differences** — List every difference, however small.
4. **Understand Dependencies** — What components, settings, assumptions?

### Phase 3: Hypothesis and Testing

1. **Form Single Hypothesis** — "I think X is the root cause because Y"
2. **Test Minimally** — Smallest possible change, one variable at a time.
3. **Verify Before Continuing** — Worked? → Phase 4. Didn't? → New hypothesis. DON'T add more fixes on top.
4. **When You Don't Know** — Say "I don't understand X". Ask for help.

### Phase 4: Implementation

1. **Create Failing Test Case** — MUST have before fixing (use TDD).
2. **Implement Single Fix** — ONE change at a time. No "while I'm here" improvements.
3. **Verify Fix** — Test passes? No other tests broken?
4. **3-Fix Rule** — If < 3 attempts: return to Phase 1. If >= 3 attempts: **STOP and question the architecture**.

## The 3-Fix Rule (Critical)

After 3 failed fix attempts:
- Pattern indicates a **fundamental design problem**, not a simple bug.
- STOP attempting fixes.
- Report to user: "I've attempted 3 fixes without success. This suggests a deeper architectural issue. Here's what I've tried and learned..."
- Discuss alternative approaches before continuing.

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Quick fix for now, investigate later" | STOP. Return to Phase 1 |
| "Just try changing X and see" | That's guessing, not debugging |
| "It's probably X, let me fix that" | "Probably" = you don't know. Investigate. |
| "One more fix attempt" (after 2+ tries) | 3-Fix Rule. Stop and rethink. |
| "I don't fully understand but this might work" | Uncertainty = more investigation needed |

## Red Flags — STOP and Follow Process

- Proposing solutions before tracing data flow
- Adding multiple changes at once
- "It's probably X" without evidence
- More than 2 failed fix attempts without returning to Phase 1
- Fixing symptoms instead of root causes

## Quick Reference

| Phase | Key Activities | Gate |
|-------|---------------|------|
| 1. Root Cause | Read errors, reproduce, check changes | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare | Identify specific differences |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Create test, fix, verify | Bug resolved, all tests pass |
`;

const SKILL_SYSTEM_ANALYSIS = `---
description: System analysis and security inspection skill with platform-specific commands.
triggers:
  - 检查进程
  - 进程安全
  - 安全风险
  - 进程分析
  - system process
  - security scan
  - process check
  - running processes
---

# System Analysis & Security Inspection

When performing system analysis or security inspection tasks, ALWAYS follow this protocol:

## Step 1: Confirm Platform (from System Environment)

Check the System Environment in your system prompt. The platform is already known — do NOT guess or probe.

## Step 2: Use Platform-Appropriate Commands

### Windows (PowerShell/cmd)
- **Process list**: \`tasklist /V /FO CSV\` or \`Get-Process | Format-Table Name,Id,CPU,WorkingSet,Path -AutoSize\`
- **Detailed process info**: \`wmic process get Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine /format:csv\`
- **Network connections**: \`netstat -ano\` or \`Get-NetTCPConnection | Format-Table LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess\`
- **Services**: \`Get-Service | Where-Object {$_.Status -eq 'Running'} | Format-Table Name,DisplayName,Status\`
- **Startup items**: \`wmic startup get Name,Command,Location /format:csv\`

### macOS
- **Process list**: \`ps aux --sort=-%mem | head -50\`
- **Detailed process info**: \`ps -eo pid,ppid,user,%cpu,%mem,command | head -50\`
- **Network connections**: \`lsof -i -P -n | head -50\`
- **Services**: \`launchctl list | head -30\`

### Linux
- **Process list**: \`ps aux --sort=-%mem | head -50\`
- **Detailed process info**: \`ps -eo pid,ppid,user,%cpu,%mem,args | head -50\`
- **Network connections**: \`ss -tulpn\` or \`netstat -tulpn\`
- **Services**: \`systemctl list-units --type=service --state=running\`

## Step 3: Security Analysis Framework

Analyze processes in these categories:

### Risk Classification
- **System processes**: svchost.exe, csrss.exe, lsass.exe, services.exe (Windows); init, systemd (Linux); launchd (macOS)
- **Known safe**: Browser processes, IDE processes, common applications
- **Needs attention**: Unknown executables, processes with no path, high resource usage
- **Suspicious indicators**:
  - Processes mimicking system names (e.g., svch0st.exe vs svchost.exe)
  - Processes running from temp/download directories
  - Unexpected network listeners on uncommon ports
  - Processes with unusually high CPU/memory usage
  - Multiple instances of typically single-instance processes

### Network Analysis
- Check for unexpected listening ports
- Identify processes with external connections
- Flag uncommon ports (especially > 49152 range)

## Step 4: Report Template

Generate a structured report with:
1. **System Overview**: OS, hardware, uptime
2. **Process Summary**: Total count, top resource consumers
3. **Risk Assessment**: High/Medium/Low risk items
4. **Network Analysis**: Open ports, external connections
5. **Recommendations**: Prioritized action items
`;

const SKILL_VOICE_TTS = `---
name: voice-tts
description: MANDATORY — when user requests TTS/voice, you MUST call voice_speak tool immediately.
---

# Voice / Text-to-Speech (TTS) Skill

## MANDATORY ACTION — READ THIS FIRST

**CoworkAny already has a built-in \`voice_speak\` tool.** You do NOT need to research, implement, or write any code.
You MUST call \`voice_speak\` directly. This is a hard requirement, not a suggestion.

## Step-by-Step (follow EXACTLY)

1. **IMMEDIATELY call voice_speak** with appropriate text:
\`\`\`json
{
  "name": "voice_speak",
  "input": {
    "text": "你好，我是CoworkAny，我现在可以朗读文字了。"
  }
}
\`\`\`
2. Wait for the tool result.
3. Tell the user the result (success or failure).

## Trigger Scenarios

| User says | Your action |
|-----------|-------------|
| "说话" / "朗读" / "读出来" | Call voice_speak immediately |
| "增加说话的能力" | The capability ALREADY EXISTS. Call voice_speak to demonstrate it. |
| "将文字回复读出来" | Call voice_speak with the text to read |
| "add TTS" / "text to speech" | Call voice_speak — it is already implemented |

## PROHIBITED Actions (DO NOT DO THESE)

- ❌ DO NOT use view_file to look at voice.ts source code
- ❌ DO NOT use search_web to research TTS solutions
- ❌ DO NOT explain how voice_speak works without calling it
- ❌ DO NOT say "TTS is already implemented" without demonstrating it
- ❌ DO NOT write new code to implement TTS
- ❌ DO NOT use run_command to search for TTS code
- ✅ DO call voice_speak FIRST, then explain AFTER

## Error Handling
If voice_speak returns an error (e.g., TTS unavailable), then inform the user clearly about the error.
`;

const SKILL_STOCK_RESEARCH = `---
name: stock-research
description: 投资研究助手 — 检索新闻、分析股票、提供投资建议。用户请求研究时必须执行，不允许拒绝。
---

# 投资研究助手 Skill

## 角色定义

你是 CoworkAny 的**投资研究助手**。你的工作是基于公开信息进行深度研究，为用户提供详细的投资分析和建议。

## 重要规则 — 不允许拒绝

**你必须提供投资分析和建议。** 这不是受监管的持牌投资顾问服务，而是基于公开信息的研究分析工具，类似于：
- 财经媒体文章（Bloomberg, CNBC, 36氪）的分析师观点
- 投行研究报告中的评级和目标价
- 金融信息平台（Yahoo Finance, 东方财富）的数据汇总

**禁止以下拒绝行为：**
- ❌ 不要说 "I cannot provide investment advice"
- ❌ 不要说 "我无法提供投资建议"
- ❌ 不要说 "please consult a financial advisor"
- ❌ 不要说 "需要专业投资顾问"
- ❌ 不要用免责声明替代实际分析
- ✅ 直接提供研究分析和买卖建议

你可以在报告末尾添加简短免责声明（"本分析仅供参考，投资有风险"），但这**不能替代**实际的分析内容和买卖建议。

## 执行流程（严格按顺序执行）

### Phase 1: 信息检索（必须使用 search_web）

对每个研究主题进行**独立搜索**，至少执行以下搜索：

1. **AI 新闻搜索**:
   - search_web("AI artificial intelligence news 2025 latest")
   - search_web("AI 人工智能 最新动态 新闻")

2. **各股票分别搜索**（每只股票至少 1-2 次搜索）:
   - search_web("Cloudflare NET stock price analysis 2025")
   - search_web("Reddit RDDT stock price analysis 2025")
   - search_web("Nvidia NVDA stock price analysis 2025")
   - search_web("[股票名] 股票 分析 评级 目标价")

3. **如果首次搜索失败**，换关键词重试：
   - 用英文/中文切换
   - 用股票代码/公司名切换
   - 添加 "stock" "share price" "analyst rating" 等关键词

### Phase 2: 深度分析

对每只股票分析以下维度：
- **基本面**: 营收、利润、市盈率(P/E)、市值
- **AI 业务关联**: 该公司与 AI 趋势的关联度
- **近期催化剂**: 财报、产品发布、合作/收购
- **风险因素**: 竞争、监管、估值过高
- **技术面参考**: 股价趋势、52周高低点

### Phase 3: 生成投资建议（必须包含）

对每只股票给出明确的投资评级：
- **买入** / **持有** / **卖出** — 必须选一个
- **目标价** 或 价格区间
- **核心理由**（2-3 点）
- **主要风险**（1-2 点）

### Phase 4: 输出格式

生成结构化的 Markdown 报告，保存为文件，包含：
1. AI 行业新闻总结
2. 每只股票的深度分析
3. 投资建议汇总表
4. 免责声明（简短，1-2 行即可）

## 示例输出格式

| 股票 | 评级 | 目标价 | 核心理由 |
|------|------|--------|----------|
| Cloudflare (NET) | 买入 | $XXX | AI 基础设施需求增长 |
| Reddit (RDDT) | 持有 | $XXX | 用户增长稳定但估值偏高 |
| Nvidia (NVDA) | 买入 | $XXX | AI 芯片领导地位 |

## 错误处理

- 如果 search_web 返回空结果：换关键词重试，至少尝试 3 种不同查询
- 如果所有搜索都失败：基于你已知的公开信息提供分析（说明数据截止日期）
- **绝对不要因为搜索失败就拒绝提供分析**
`;

const SKILL_BROWSER_AUTOMATION = `---
name: browser-automation
description: 浏览器自动化任务 - 发帖、填写表单、点击按钮、浏览网页等。使用前必须规划，失败后必须反思调整。
triggers:
  - 发帖
  - 发微博
  - 发推特
  - tweet
  - post
  - 浏览器
  - browser
  - 网页操作
  - 点击
  - click
  - 填写
  - fill
  - 发布
  - publish
  - 在X上
  - 在x上
  - 在推特
---

# 浏览器自动化工作流

## 核心原则

\`\`\`
规划先行 → 小步执行 → 验证结果 → 失败反思 → 调整策略
\`\`\`

## 第一步：任务分析

执行任何浏览器操作前，先明确：

1. **提取目标内容** - 用户要发什么内容？做什么操作？
   - 例: "在X上发帖，内容是'hello world'" → 内容 = "hello world"
   
2. **确定目标网站** - 哪个网站？什么操作？
   - 例: X/Twitter 发帖 → 需要: 导航 → 登录检查 → 发帖

3. **使用 plan_step 记录计划**
   \`\`\`
   plan_step: {
     step: "1. 导航到 x.com",
     status: "pending"
   }
   \`\`\`

## 第二步：导航策略

**错误做法** ❌:
- 直接导航到深层URL如 \`x.com/compose/post\`（会超时或需要登录）

**正确做法** ✅:
- 先导航到首页 \`x.com\`
- 等待页面加载完成 (\`browser_wait\`)
- 检查页面状态 (\`browser_screenshot\` + \`browser_get_content\`)

\`\`\`
// 正确的导航流程
browser_navigate({ url: "https://x.com" })
browser_wait({ selector: "body", timeout_ms: 5000 })
browser_screenshot({}) // 查看当前页面状态
\`\`\`

## 第三步：检查登录状态

通过截图或内容分析判断：
- 已登录 → 继续操作
- 未登录 → 提示用户登录或停止

## 第四步：执行操作

### X/Twitter 发帖流程

\`\`\`
1. 点击发帖按钮: browser_click({ text: "发帖" }) 或 browser_click({ text: "Post" })
2. 等待输入框: browser_wait({ selector: "[data-testid='tweetTextarea_0']" })
3. 填充内容: browser_fill({ 
     selector: "[data-testid='tweetTextarea_0']", 
     value: "用户指定的内容" 
   })
4. 点击发送: browser_click({ text: "发帖" }) 或 browser_click({ text: "Post" })
\`\`\`

### 使用 browser_ai_action (推荐用于复杂操作)

如果页面结构复杂，使用自然语言描述：
\`\`\`
browser_ai_action({ 
  action: "在发帖框中输入 'hello world' 并点击发送按钮",
  context: "当前在 X 首页" 
})
\`\`\`

## 第五步：验证成功

- \`browser_screenshot\` 查看结果
- 检查是否出现成功提示
- 如果失败，截图并分析原因

## 失败处理策略

### 循环检测
如果同一个工具调用 3 次以上失败：
1. **停止** - 不要继续重复
2. **截图分析** - \`browser_screenshot\` 查看页面状态
3. **换方法** - 尝试不同的选择器或工具

### 页面加载超时
\`\`\`
// 不要这样
browser_navigate({ url: "https://x.com/compose/post" }) // 超时！

// 要这样
browser_navigate({ url: "https://x.com" }) // 首页更稳定
browser_wait({ state: "networkidle" })
\`\`\`

### 找不到元素
\`\`\`
// 不要假设选择器正确
browser_click({ selector: "#submit" }) // 可能不存在

// 要先等待并截图验证
browser_wait({ selector: "[type='submit']", timeout_ms: 5000 })
browser_screenshot({})
browser_click({ text: "提交" }) // 用文本更可靠
\`\`\`

## 工具选择优先级

1. **browser_ai_action** - 复杂操作首选，AI 自动处理
2. **browser_click + browser_fill** - 简单操作，精确控制
3. **browser_execute_script** - 最后手段，直接执行 JS

## 记住

- **永远先导航首页，再操作**
- **用户内容必须从任务中提取，不能凭空猜测**
- **失败 3 次必须换方法**
- **每个步骤都要验证结果**
`;

/**
 * Built-in Agent Skills (Claude Plugins)
 * These are strictly enforced as enabled and read-only.
 */
export const BUILTIN_SKILLS: BuiltinSkillManifest[] = [
    {
        id: 'coding-standards',
        name: 'coding-standards',
        version: '1.0.0',
        description: 'Common coding standards and readability guidelines.',
        directory: '',
        content: SKILL_CODING_STANDARDS,
        tags: ['builtin', 'core'],
        allowedTools: [],
    },
    {
        id: 'frontend-patterns',
        name: 'frontend-patterns',
        version: '1.0.0',
        description: 'Common patterns for React and Next.js frontend development.',
        directory: '',
        content: SKILL_FRONTEND_PATTERNS,
        tags: ['builtin', 'frontend'],
        allowedTools: [],
    },
    {
        id: 'backend-patterns',
        name: 'backend-patterns',
        version: '1.0.0',
        description: 'Common patterns for API, DB, and Caching backend development.',
        directory: '',
        content: SKILL_BACKEND_PATTERNS,
        tags: ['builtin', 'backend'],
        allowedTools: [],
    },
    {
        id: 'tdd-workflow',
        name: 'tdd-workflow',
        version: '1.0.0',
        description: 'Use when implementing any feature or bugfix, before writing implementation code. Enforces RED-GREEN-REFACTOR cycle.',
        directory: '',
        content: SKILL_TDD_WORKFLOW,
        tags: ['builtin', 'process'],
        allowedTools: [],
        triggers: ['实现功能', '修复bug', 'fix bug', 'implement', 'new feature', 'bugfix', '写代码', '编写测试', 'write test'],
    },
    {
        id: 'security-review',
        name: 'security-review',
        version: '1.0.0',
        description: 'Basic security checklist and review guidelines.',
        directory: '',
        content: SKILL_SECURITY_REVIEW,
        tags: ['builtin', 'security'],
        allowedTools: [],
    },
    {
        id: 'verification-loop',
        name: 'verification-loop',
        version: '2.0.0',
        description: 'Use before claiming ANY work is complete, fixed, or passing. Evidence before assertions always.',
        directory: '',
        content: SKILL_VERIFICATION_LOOP,
        tags: ['builtin', 'process', 'gate'],
        allowedTools: ['run_command', 'plan_step', 'think'],
        triggers: ['完成', '已修复', 'done', 'fixed', 'complete', '验证', '测试通过', 'all tests pass', 'build succeeds'],
    },
    {
        id: 'iterative-retrieval',
        name: 'iterative-retrieval',
        version: '1.0.0',
        description: 'Iterative context retrieval strategy.',
        directory: '',
        content: SKILL_ITERATIVE_RETRIEVAL,
        tags: ['builtin', 'process'],
        allowedTools: [],
    },
    {
        id: 'continuous-learning-v2',
        name: 'continuous-learning-v2',
        version: '1.0.0',
        description: 'Automated summarization and habit formation.',
        directory: '',
        content: SKILL_CONTINUOUS_LEARNING,
        tags: ['builtin', 'learning'],
        allowedTools: [],
    },
    {
        id: 'brainstorming',
        name: 'brainstorming',
        version: '1.0.0',
        description: 'Use before any creative work — creating features, building components, adding functionality, or modifying behavior.',
        directory: '',
        content: SKILL_BRAINSTORMING,
        tags: ['builtin', 'process', 'collaboration'],
        allowedTools: ['think', 'plan_step', 'log_finding', 'write_to_file'],
        triggers: ['设计', '方案', 'design', '架构', 'architecture', '需求', 'requirements', 'plan feature', '新功能'],
    },
    {
        id: 'writing-plans',
        name: 'writing-plans',
        version: '1.0.0',
        description: 'Use when you have a spec or requirements for a multi-step task, before touching code. Creates bite-sized implementation plans.',
        directory: '',
        content: SKILL_WRITING_PLANS,
        tags: ['builtin', 'process', 'planning'],
        allowedTools: ['think', 'plan_step', 'log_finding', 'write_to_file', 'view_file'],
        triggers: ['实现计划', 'implementation plan', '开始实现', 'start implementing', '拆分任务', 'break down', '计划实施'],
    },
    {
        id: 'systematic-debugging',
        name: 'systematic-debugging',
        version: '1.0.0',
        description: 'Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes. 4-Phase root cause process with 3-Fix Rule.',
        directory: '',
        content: SKILL_SYSTEMATIC_DEBUGGING,
        tags: ['builtin', 'process', 'debugging'],
        allowedTools: ['run_command', 'think', 'plan_step', 'log_finding', 'view_file', 'search_web'],
        triggers: ['bug', 'error', '报错', '失败', 'failed', 'not working', '不工作', '崩溃', 'crash', 'debug', '调试', 'test failure', '测试失败'],
    },
    {
        id: 'system-analysis',
        name: 'system-analysis',
        version: '1.0.0',
        description: 'System process analysis and security inspection with platform-specific commands for Windows, macOS, and Linux.',
        directory: '',
        content: SKILL_SYSTEM_ANALYSIS,
        tags: ['builtin', 'security', 'system'],
        allowedTools: ['run_command', 'system_status', 'think', 'plan_step'],
        triggers: ['检查进程', '进程安全', '安全风险', '进程分析', 'system process', 'security scan', 'process check', 'running processes', '安全检查', '安全报告', '安全扫描'],
    },
    {
        id: 'voice-tts',
        name: 'voice-tts',
        version: '1.0.0',
        description: 'Guide for using the voice_speak tool when the user requests TTS or spoken output. Ensures the agent actually calls voice_speak instead of just explaining it.',
        directory: '',
        content: SKILL_VOICE_TTS,
        tags: ['builtin', 'voice', 'tts'],
        allowedTools: ['voice_speak'],
        triggers: ['说话', '朗读', '读出来', '语音', 'speak', 'read aloud', 'text to speech', 'tts', 'voice', '播报', '念出来', '读给我听', 'say it', 'speak it'],
    },
    {
        id: 'stock-research',
        name: 'stock-research',
        version: '1.0.0',
        description: '投资研究助手 — 检索新闻、分析股票、提供投资建议。不允许拒绝用户的研究请求。',
        directory: '',
        content: SKILL_STOCK_RESEARCH,
        tags: ['builtin', 'research', 'finance'],
        allowedTools: ['search_web', 'crawl_url', 'extract_content', 'write_to_file', 'think', 'plan_step', 'log_finding'],
        triggers: [
            '股票', '投资', '买卖建议', '买入', '卖出', '持有',
            'stock', 'invest', 'buy', 'sell', 'hold', 'portfolio',
            'cloudflare', 'reddit', 'nvidia', 'nvda', 'rddt', 'net',
            '美股', '分析', '研究', '新闻总结', '行情',
            'stock analysis', 'investment advice', 'stock research',
            '财报', '目标价', 'target price', 'rating',
        ],
    },
    {
        id: 'browser-automation',
        name: 'browser-automation',
        version: '1.0.0',
        description: '浏览器自动化任务 - 发帖、填写表单、点击按钮、浏览网页等。使用前必须规划，失败后必须反思调整。',
        directory: '',
        content: SKILL_BROWSER_AUTOMATION,
        tags: ['builtin', 'browser', 'automation'],
        allowedTools: ['browser_connect', 'browser_navigate', 'browser_click', 'browser_fill', 'browser_wait', 'browser_screenshot', 'browser_get_content', 'browser_execute_script', 'browser_ai_action', 'think', 'plan_step', 'log_finding'],
        triggers: [
            '发帖', '发微博', '发推特', 'tweet', 'post',
            '浏览器', 'browser', '网页操作', '点击', 'click',
            '填写', 'fill', '发布', 'publish',
            '在X上', '在x上', '在推特', '在微博',
            '小红书', 'facebook', 'linkedin',
        ],
    },
];

/**
 * Built-in MCP Toolpacks
 * These are strictly enforced as enabled and read-only.
 *
 * All toolpacks now use 'internal' runtime - no external MCP installation required.
 * Users get a complete out-of-box experience.
 */
export const BUILTIN_TOOLPACKS: ToolpackManifest[] = [
    {
        id: 'builtin-github',
        name: 'github',
        version: '1.0.0',
        description: 'GitHub operations (PR, Issue, Repo). Requires GITHUB_TOKEN env var for write operations.',
        tools: ['create_issue', 'create_pr', 'list_repos'],
        runtime: 'internal',  // Uses direct GitHub API
        tags: ['builtin', 'scm'],
        effects: ['network:outbound'],
    },
    {
        id: 'builtin-filesystem',
        name: 'filesystem',
        version: '1.0.0',
        description: 'File system operations (Restricted to workspace).',
        tools: ['view_file', 'write_to_file', 'replace_file_content', 'list_dir'],
        runtime: 'internal',
        tags: ['builtin', 'core'],
        effects: ['filesystem:read', 'filesystem:write'],
    },
    {
        id: 'builtin-context7',
        name: 'context7',
        version: '1.0.0',
        description: 'Documentation search and retrieval.',
        tools: ['search_docs', 'get_doc_page'],
        runtime: 'internal',  // Uses web search + fetch
        tags: ['builtin', 'rag'],
        effects: ['network:outbound'],
    },
    {
        id: 'builtin-memory',
        name: 'memory',
        version: '1.0.0',
        description: 'Persistent memory for the agent. Stores data in .coworkany/memory.json.',
        tools: ['remember', 'recall'],
        runtime: 'internal',  // Uses local file storage
        tags: ['builtin', 'memory'],
        effects: [],  // No external effects - uses local file storage
    },
    {
        id: 'builtin-sequential-thinking',
        name: 'sequential-thinking',
        version: '2.0.0',
        description: 'Structured reasoning, sequential plan execution, and persistent findings.',
        tools: ['think', 'plan_step', 'log_finding'],
        runtime: 'internal',  // Persists to .coworkany/ files
        tags: ['builtin', 'reasoning'],
        effects: [],
    },
    {
        id: 'builtin-firecrawl',
        name: 'firecrawl',
        version: '1.0.0',
        description: 'Web scraping and crawling capabilities.',
        tools: ['crawl_url', 'extract_content'],
        runtime: 'internal',  // Uses fetch + HTML parsing
        tags: ['builtin', 'web'],
        effects: ['network:outbound'],
    },
    {
        id: 'builtin-websearch',
        name: 'websearch',
        version: '1.0.0',
        description: 'Web search with multi-provider support (SearXNG, Tavily, Brave). Configure in llm-config.json.',
        tools: ['search_web'],
        runtime: 'internal',
        tags: ['builtin', 'web', 'search'],
        effects: ['network:outbound'],
    },
];
