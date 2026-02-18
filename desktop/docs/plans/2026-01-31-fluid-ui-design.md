# Fluid Agent UI Design Proposal

**Date**: 2026-01-31
**Topic**: Fluid Interface & Multi-tasking Strategy
**Status**: DRAFT

## 1. Executive Summary

This document proposes a **"Fluid Agent"** interface for CoworkAny, shifting away from a traditional heavy IDE layout to a lightweight, state-adaptive model.

**Core Philosophy**:
- **Copilot First**: The user's primary entry point is a lightweight Launcher.
- **On-Demand Depth**: Complexity (Dashboard) is hidden until requested.
- **Background Focus**: Multi-tasking is handled via background queues, ensuring the user's immediate attention remains focused on the active context.

## 2. Interaction Model: The Three-State Window

The main application window will dynamically resize and change layout based on its current state.

### State 1: The Launcher (Capsule)
*The default, idle state.*
- **Appearance**: A centered, floating search bar (similar to Spotlight/Raycast).
- **Size**: Small (~600px x 60px).
- **Functionality**:
    - Natural Language Input ("Fix the bug in main.ts").
    - Quick Actions (slash commands: `/settings`, `/new`).
    - Recent Context selection.
- **Behavior**: Dismisses locally when focus is lost (optional setting).

### State 2: The Active Panel (Companion)
*The working state.*
- **Appearance**: Automatically expands downwards from the Launcher when a task begins.
- **Size**: Compact Floating Panel (~600px x 400px).
- **Functionality**:
    - **Progress Stream**: Shows live Agent thinking steps.
    - **User Decision**: Prompts for "Approve/Reject" on sensitive actions.
    - **Mini-Diff**: Lightweight view of code changes.
- **Position**: Can be dragged to a screen corner (Docked Mode) to accompany other work.

### State 3: The Dashboard (Management)
*The configuration and overview state.*
- **Appearance**: A full-sized window (standard desktop app size).
- **Trigger**: Click "Expand/Grid" icon, or use specific commands (`/dashboard`, `/settings`).
- **Functionality**:
    - **Task Manager**: View and manage background tasks.
    - **Skill Market**: Install and configure Skills.
    - **MCP Registry**: Manage tool connections.
    - **Settings**: Global configuration.

## 3. Multi-tasking Strategy: Backend Hub

To support concurrent tasks without cluttering the screen with multiple floating windows, we adopt a **Backend Hub** model.

1.  **Single Active Focus**: The "Active Panel" (State 2) always displays the *current* focal task.
2.  **Backgrounding**:
    - User can click "Hide" or "Minimize" on a running task.
    - The task continues executing in the Sidecar (Node.js process).
    - The UI reverts to **State 1 (Launcher)**, ready for a new command.
3.  **Notifications**:
    - If a background task needs input (e.g., "Review needed"), a System Notification or a badge on the Launcher icon appears.
4.  **Task Switching**:
    - Opening the **Dashboard (State 3)** reveals a "Task List".
    - Clicking a background task immediately restores it to the **Active Panel (State 2)**.

## 4. Technical Implications

### Window Management (Rust/Tauri)
- **Dynamic Resizing**: Need precise control over `webview_window.set_size()` and styling (transparent backgrounds, rounded corners).
- **Focus Management**: The Launcher needs global shortcuts (`Alt+Space`) and focus-loss handling.

### State Persistence
- **Task Store**: A robust Redux/Zustand store (persisted to disk) is required to track the state of "Background" vs "Active" tasks, so they can be rehydrated when switched back.

## 5. Next Steps
1.  **Prototype**: Build a minimal React component demonstrating the animation between "Launcher" and "Panel".
2.  **Tauri Config**: prototype window resizing logic in Rust.
