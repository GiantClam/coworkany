# CoworkAny Desktop - Project Overview

## 1. Introduction
CoworkAny Desktop is a next-generation AI coding agent platform designed for security, extensibility, and modern developer experience. It leverages a hybrid **Tauri + Sidecar** architecture to combine the performance and safety of Rust with the dynamic ecosystem of Node.js/TypeScript for AI logic.

## 2. Technical Architecture

### Tech Stack
| Layer | Technology | Role |
|-------|------------|------|
| **Host** | **Tauri (Rust)** | System access, Window management, Security Policy, File System shadowing. |
| **Frontend** | **React + Vite** | User Interface, Terminal, Chat, Config Management. |
| **Engine** | **Node.js / Bun** | "Sidecar" process running the AI Agent, MCP clients, and Tool execution. |
| **Protocol** | **JSON-RPC / IPC** | Communication bridge between UI, Host, and Engine. |

### Architecture Diagram
```mermaid
graph TD
    UI[Frontend (React)] <-->|Tauri IPC| Rust[Host (Rust)]
    Rust <-->|Stdio / JSON Lines| Sidecar[Sidecar (Node.js)]
    
    subgraph Host [Rust Core]
        Policy[Policy Engine]
        Shadow[ShadowFS]
        IPC[Command Bridge]
    end
    
    subgraph Engine [Sidecar]
        Agent[AI Agent]
        MCP[MCP Client]
        Skills[Skill Runtime]
    end
    
    Rust -->|Secure IO| FS[File System]
    Sidecar -->|Tool Calls| Rust
    Sidecar -->|API| LLM[Anthropic/OpenAI]
```

## 3. Core Modules

### 3.1 Host (Rust)
- **Sidecar Manager**: Robust process supervision for the AI engine (Node/Bun). Handles spawning, heartbeat, and graceful shutdown.
- **ShadowFS**: A Virtual File System layer that captures all agent modification attempts. Instead of writing directly to disk, changes are drafted as "Patches" (Git-style diffs) for user review.
- **Policy Engine**: Intercepts tool calls (e.g., `fs_write`, `run_command`). Applies rules (Allow/Deny/Ask User) based on security configurations.
- **IPC Protocol**: Strictly typed JSON protocol (Zod-compatible) ensuring timestamp precision (ISO 8601) and command structure integrity.

### 3.2 Frontend (React)
- **Obsidian Forge / Paperwhite UI**: A theme-able, professional IDE-like interface with Chat, Sidebar, and Panels.
- **Chat Interface**: Rich text streaming, Code block highlighting, and SVG-enhanced interactions.
- **Skill & MCP Manager**: Dedicated views to install, configure, and toggle:
  - **Toolpacks (MCP)**: Standards-based tool servers (e.g., Filesystem, Git, Postgres).
  - **Claude Skills**: Specialized agent workflows (e.g., "Frontend Design", "Docs Writer").
- **Diff Viewer**: Visual comparison tool for reviewing ShadowFS patches before application.

### 3.3 Sidecar (TypeScript)
- **Agent Loop**: Manages the Plan-Act-Verify cycle.
- **MCP Integration**: Connects to local or remote MCP servers to extend agent capabilities without rebuilding the core.
- **Sandboxing**: Executes code in a controlled environment (delegated to Rust for sensitive ops).

## 4. Key Workflows

### 4.1 Task Execution
1. **User** types a query in Chat.
2. **Frontend** sends `start_task` to Rust.
3. **Rust** forwards to **Sidecar**.
4. **Sidecar** analyzes request, calls LLM, and decides on a tool (e.g., `read_file`).
5. **Rust/Policy** intercepts: "Is this safe?" -> Auto-approve (read) or Block.
6. **Sidecar** receives data, reasons, and calls `write_file`.
7. **Rust/ShadowFS** intercepts: Creates a **Patch**.
8. **Frontend** shows "Review Changes" dialog.
9. **User** clicks "Approve".
10. **Rust** applies Patch to disk.

### 4.2 Extension System
- **Skills**: Folders containing `SKILL.md` (instructions) and implementation files. Loaded dynamically by Sidecar.
- **Toolpacks**: MCP Servers installed via Registry or Local Path. Rust manages their lifecycle and wiring to the agent.

## 5. Security Features
- **Human-in-the-Loop**: Critical actions (Shell commands, File writes) default to "Require Confirmation".
- **Time-Travel Recovery**: ShadowFS allows reverting pending changes.
- **Process Isolation**: The AI logic runs in a deprivileged Sidecar process; it cannot bypass the Rust host's security controls.
