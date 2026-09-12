"use client";

import React, { useState, type ReactNode } from "react";
import { MessagePlainText, MessageResponse } from "./ai-elements";
import { artifactDisplayName } from "./artifact-label";

export type WorkbenchMessageRole = "assistant" | "user" | "system";

function workbenchLocale() {
  return typeof document !== "undefined" && document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "zh";
}

export type WorkbenchMessageFrameProps = {
  role: WorkbenchMessageRole;
  label?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

/** Shared message frame used by the online dashboard and the Tauri adapter. */
export function WorkbenchMessageFrame({ role, label, icon, action, children, className = "", bodyClassName = "" }: WorkbenchMessageFrameProps) {
  const isUser = role === "user";
  const avatar = icon ?? <span className="wb-message-avatar-label">{isUser ? "U" : "AI"}</span>;
  return (
    <div className={`wb-message-frame wb-message-${role} ${className}`.trim()} data-cloud-surface="message">
      <div className="wb-message-inner">
        <div className="wb-message-avatar">{avatar}</div>
        <div className="wb-message-content">
          {(label || action) ? <div className="wb-message-header"><div className="wb-message-label">{label}</div>{action}</div> : null}
          <div className={`wb-message-body ${bodyClassName}`.trim()}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export type WorkbenchTaskEvent = { type: string; label: string; detail?: string; status?: "queued" | "info" | "running" | "completed" | "failed" };

export function WorkbenchTaskEvents({ events, limit = 4, className = "" }: { events: WorkbenchTaskEvent[]; limit?: number; className?: string }) {
  const recent = events.slice(-Math.max(1, limit));
  if (!recent.length) return null;
  return (
    <div className={`wb-message-events ${className}`.trim()} data-testid="workspace-task-events">
      {recent.map((event, index) => <div className="wb-message-event" key={`${event.type}-${index}`}><span className={`wb-event-dot wb-event-${event.status ?? "queued"}`} /> <span>{event.label}{event.detail ? <span className="wb-event-detail">{event.detail}</span> : null}</span></div>)}
    </div>
  );
}

/**
 * Host-neutral cloud message frame. Hosts keep ownership of rich message
 * parts and artifact actions, while the shared package owns the common
 * dashboard geometry used by SaaS and desktop.
 */
export function WorkbenchCloudMessageShell({
  role,
  label,
  timestamp,
  children,
  attachments,
  footer,
  className = "",
}: {
  role: "assistant" | "user";
  label: string;
  timestamp: ReactNode;
  children: ReactNode;
  attachments?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  if (role === "user") {
    return (
      <div className={`wb-cloud-message wb-cloud-message-user ${className}`.trim()} data-cloud-surface="message">
        <div className="message-card-user">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="dashboard-kicker text-primary">{label}</div>
            <div className="text-xs text-white/55">{timestamp}</div>
          </div>
          {children}
          {attachments}
        </div>
        <div className="ai-avatar wb-chat-user-avatar" aria-label={label}>U</div>
      </div>
    );
  }
  return (
    <div className={`wb-cloud-message wb-cloud-message-assistant ${className}`.trim()} data-cloud-surface="message">
      <div className="ai-avatar mt-1 shrink-0">AI</div>
      <article className="message-card assistant-message">
        <div className="message-header assistant-message-header">
          <div className="min-w-0 flex-1">
            <div className="dashboard-kicker text-foreground">{label}</div>
            <div className="message-time">{timestamp}</div>
          </div>
        </div>
        {children}
        {footer}
      </article>
    </div>
  );
}

/** Shared Markdown body so desktop and cloud render the same authored content. */
function WorkbenchMessageMarkdown({ content, className = "" }: { content: string; className?: string }) {
  return <MessageResponse content={content} className={className} />;
}

/**
 * Cloud AI-entry compatible message card used by the Tauri adapter.
 * Keep the DOM/class contract aligned with components/ai-entry/ai-entry-workspace.tsx
 * so both surfaces share the same avatar, bubble and timestamp geometry.
 */
export function WorkbenchChatMessage({
  role,
  content,
  label,
  timestamp = new Date(),
  pending = false,
  events = [],
  artifacts = [],
  onArtifactOpen,
  attachments = [],
}: {
  role: "assistant" | "user";
  content: string;
  label?: string;
  timestamp?: Date | string;
  pending?: boolean;
  events?: WorkbenchTaskEvent[];
  artifacts?: Array<{ id: string; title: string; relativePath: string; mimeType: string; byteLength?: number }>;
  onArtifactOpen?: (relativePath: string, mimeType: string) => void;
  attachments?: Array<{ id: string; name: string; mediaType?: string }>;
}) {
  const locale = workbenchLocale();
  const copy = locale === "en" ? { user: "Your prompt", response: "AI RESPONSE", copy: "Copy reply", pending: "Generating…", artifacts: "Generated artifacts" } : { user: "你的指令", response: "AI RESPONSE", copy: "复制回复", pending: "正在生成…", artifacts: "生成产物" };
  const time = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const copyReply = async (button: HTMLButtonElement) => {
    if (!content) return;
    try {
      await globalThis.navigator?.clipboard?.writeText(content);
      const original = button.textContent;
      button.textContent = "✓";
      globalThis.setTimeout(() => { button.textContent = original; }, 1400);
    } catch {
      button.textContent = "!";
    }
  };
  if (role === "user") {
    return (
      <div className="wb-cloud-message wb-cloud-message-user" data-cloud-surface="message">
        <div className="message-card-user">
          <div className="message-header">
            <div className="dashboard-kicker text-primary">{label ?? copy.user}</div>
            <div className="text-xs text-white/55">{time}</div>
          </div>
          <MessagePlainText className="message-body wb-chat-user-body" content={content} />
          {attachments.length ? <div className="wb-message-attachments">{attachments.map((attachment) => <span key={attachment.id} className="wb-message-attachment"><span aria-hidden="true">{attachment.mediaType?.startsWith("image/") ? "▧" : "⌕"}</span>{attachment.name}</span>)}</div> : null}
        </div>
        <div className="ai-avatar wb-chat-user-avatar">U</div>
      </div>
    );
  }
  return (
    <div className="wb-cloud-message wb-cloud-message-assistant" data-cloud-surface="message">
      <div className="ai-avatar">AI</div>
      <article className="message-card assistant-message">
        <div className="message-header assistant-message-header">
          <div className="min-w-0 flex-1">
            <div className="dashboard-kicker text-foreground">{label ?? copy.response}</div>
            <div className="message-time">{time}</div>
          </div>
          {content ? <div className="message-actions message-feedback"><button type="button" className="message-feedback-btn" onClick={(event) => void copyReply(event.currentTarget)} aria-label={copy.copy} title={copy.copy}>⧉</button></div> : null}
        </div>
        {pending ? <div className="wb-chat-pending"><span className="wb-chat-pending-dot" />{copy.pending}</div> : content ? <WorkbenchMessageMarkdown className="message-body assistant-body" content={content} /> : null}
        {events.length ? <div className="assistant-live-panel"><WorkbenchTaskEvents events={events} limit={4} className="pl-0" /></div> : null}
        {artifacts.length ? <section className="wb-artifact-section"><div className="wb-artifact-title">✦ {copy.artifacts}</div><div className="wb-artifact-grid">{artifacts.map((artifact) => <button key={artifact.id} type="button" className="wb-artifact-card" onClick={() => onArtifactOpen?.(artifact.relativePath, artifact.mimeType)}><span className="wb-artifact-name">{artifactDisplayName(artifact.title, artifact.relativePath)}</span><small>{artifact.mimeType}{typeof artifact.byteLength === "number" ? ` · ${Math.ceil(artifact.byteLength / 1024)} KB` : ""}</small></button>)}</div></section> : null}
      </article>
    </div>
  );
}

/** Writer-specific message shell matching the online Writer workspace frame. */
export function WorkbenchWriterMessage({ role, label, content, timestamp, pending = false, events = [], artifacts = [], onArtifactOpen, attachments = [] }: { role: "assistant" | "user"; label: string; content: string; timestamp?: Date | string; pending?: boolean; events?: WorkbenchTaskEvent[]; artifacts?: Array<{ id: string; title: string; relativePath: string; mimeType: string; byteLength?: number }>; onArtifactOpen?: (relativePath: string, mimeType: string) => void; attachments?: Array<{ id: string; name: string; mediaType?: string }> }) {
  const locale = workbenchLocale();
  const time = new Date(timestamp ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const copy = locale === "en" ? { pending: "Generating…", artifacts: "Generated artifacts" } : { pending: "正在生成…", artifacts: "生成产物" };
  return (
    <WorkbenchMessageFrame
      role={role}
      label={label}
      icon={role === "assistant" ? <span className="wb-writer-avatar-mark" aria-hidden="true">✦</span> : undefined}
      className={`wb-writer-message wb-writer-message-${role}`}
    >
      <div className={`wb-writer-message-bubble wb-writer-message-bubble-${role}`}>
        <div className="wb-writer-message-time">{time}</div>
        {pending ? <div className="wb-chat-pending"><span className="wb-chat-pending-dot" />{copy.pending}</div> : content ? <WorkbenchMessageMarkdown className="wb-writer-message-markdown" content={content} /> : null}
        {attachments.length ? <div className="wb-message-attachments">{attachments.map((attachment) => <span key={attachment.id} className="wb-message-attachment"><span aria-hidden="true">{attachment.mediaType?.startsWith("image/") ? "▧" : "⌕"}</span>{attachment.name}</span>)}</div> : null}
        {events.length ? <div className="wb-writer-message-events"><WorkbenchTaskEvents events={events} limit={4} /></div> : null}
        {artifacts.length ? <section className="wb-artifact-section"><div className="wb-artifact-title">✦ {copy.artifacts}</div><div className="wb-artifact-grid">{artifacts.map((artifact) => <button key={artifact.id} type="button" className="wb-artifact-card" onClick={() => onArtifactOpen?.(artifact.relativePath, artifact.mimeType)}><span className="wb-artifact-name">{artifactDisplayName(artifact.title, artifact.relativePath)}</span><small>{artifact.mimeType}{typeof artifact.byteLength === "number" ? ` · ${Math.ceil(artifact.byteLength / 1024)} KB` : ""}</small></button>)}</div></section> : null}
      </div>
    </WorkbenchMessageFrame>
  );
}

export type WorkbenchShellNavItem = { path: string; label: string; section?: string; glyph?: string; icon?: ReactNode; placement?: "main" | "footer" | "hidden" };
export type WorkbenchShellSessionItem = { path: string; title: string; updatedAt?: string; agentId?: string; status?: "running" | "unread" };

export function isWorkbenchAssistantPath(path: string) {
  return path === "/dashboard/ai" || path.startsWith("/dashboard/ai/") || path.startsWith("/dashboard/ai?");
}

/** Routes whose local durable conversations are rendered in the shell sidebar. */
export function isWorkbenchSessionPath(path: string) {
  const pathname = path.split("?", 1)[0].replace(/\/+$/u, "") || "/";
  return pathname === "/dashboard/ai"
    || pathname.startsWith("/dashboard/ai/")
    || pathname === "/dashboard/writer"
    || pathname.startsWith("/dashboard/writer/")
    || pathname === "/dashboard/image-assistant"
    || pathname.startsWith("/dashboard/image-assistant/");
}

function workbenchAgentId(path: string) {
  const query = path.split("?", 2)[1];
  const agentId = query ? new URLSearchParams(query).get("agent") : null;
  return agentId?.trim() || null;
}

/**
 * Conversations belong to either a concrete Agent or an entry-only expert
 * surface. The online consulting route has no `agent` parameter, so its
 * `entry` value must remain part of the session identity.
 */
export function workbenchSessionScope(path: string) {
  const pathname = path.split("?", 1)[0].replace(/\/+$/u, "") || "/";
  // Dedicated creative surfaces own their conversations. A stale/deep-link
  // `agent` query must never move a writing or image session into an Agent's
  // sidebar group.
  if (pathname === "/dashboard/writer" || pathname.startsWith("/dashboard/writer/")) return "entry:writer";
  if (pathname === "/dashboard/image-assistant" || pathname.startsWith("/dashboard/image-assistant/")) return "entry:image-assistant";
  const query = path.split("?", 2)[1];
  const params = new URLSearchParams(query ?? "");
  const agentId = params.get("agent")?.trim();
  if (agentId) return agentId;
  const entry = params.get("entry")?.trim();
  if (entry) return `entry:${entry}`;
  return undefined;
}

export function isWorkbenchNavItemActive(itemPath: string, activePath: string, navPaths: readonly string[] = []) {
  const normalize = (path: string) => {
    const [pathname, query] = path.split("?", 2);
    const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    return query ? `${normalizedPathname}?${query}` : normalizedPathname;
  };
  const normalizedItemPath = normalize(itemPath);
  const normalizedActivePath = normalize(activePath);
  if (normalizedItemPath === normalizedActivePath) return true;
  if (navPaths.map(normalize).includes(normalizedActivePath)) return false;

  const itemBasePath = normalizedItemPath.split("?")[0];
  const activeBasePath = normalizedActivePath.split("?")[0];
  const activeAgentId = workbenchAgentId(normalizedActivePath);
  if (activeAgentId && itemBasePath === "/dashboard/ai" && navPaths.some((path) => workbenchAgentId(path) === activeAgentId)) return false;
  if (normalizedItemPath !== itemBasePath) return false;
  if (itemBasePath === "/dashboard") return activeBasePath === itemBasePath;
  return activeBasePath === itemBasePath || activeBasePath.startsWith(`${itemBasePath}/`);
}

export function WorkbenchShellFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`wb-shell-frame ${className}`.trim()}>{children}</div>;
}

export function WorkbenchShell({
  navItems,
  activePath,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  locale: shellLocale,
  onLocaleChange,
  onLocaleToggle,
  children,
  title = "MARKETING",
  localLabel = "本地工作区 · Full Access",
  status = "",
  sessions = [],
  sessionsLabel,
  activeSessionAgentId,
  activeSessionAgentLabel,
  hideSessionScopes = [],
  newSessionLabel,
  onNewSession,
  initialSessionsExpanded = false,
}: {
  navItems: WorkbenchShellNavItem[];
  activePath: string;
  onNavigate: (path: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  locale?: "zh" | "en";
  onLocaleChange?: (locale: "zh" | "en") => void;
  onLocaleToggle?: () => void;
  children: ReactNode;
  title?: string;
  localLabel?: string;
  status?: ReactNode;
  sessions?: WorkbenchShellSessionItem[];
  sessionsLabel?: string;
  /** Restricts the expanded chat list to the selected Agent, matching the web workspace. */
  activeSessionAgentId?: string | null;
  activeSessionAgentLabel?: string;
  hideSessionScopes?: readonly string[];
  newSessionLabel?: string;
  onNewSession?: () => void;
  initialSessionsExpanded?: boolean;
}) {
  const [assistantSessionsExpanded, setAssistantSessionsExpanded] = useState(initialSessionsExpanded);
  const locale = shellLocale ?? workbenchLocale();
  const toggleCopy = locale === "en"
    ? { navigation: "Workspace navigation", expand: "Expand sidebar", collapse: "Collapse sidebar", recent: "Recent chats", newSession: "New chat", empty: "No chats yet" }
    : { navigation: "工作区导航", expand: "展开侧栏", collapse: "收起侧栏", recent: "最近会话", newSession: "新建会话", empty: "暂无会话" };
  const visibleNavItems = navItems.filter((item) => item.placement !== "hidden");
  const mainNavItems = visibleNavItems.filter((item) => item.placement !== "footer");
  const footerNavItems = navItems.filter((item) => item.placement === "footer");
  const navPaths = navItems.map((item) => item.path);
  const activeSessionScope = workbenchSessionScope(activePath);
  const hasMatchingSessionNav = Boolean(activeSessionScope && navItems.some((item) => workbenchSessionScope(item.path) === activeSessionScope));
  const renderSessionSection = (item: WorkbenchShellNavItem) => {
    const itemSessionScope = workbenchSessionScope(item.path);
    if (itemSessionScope && hideSessionScopes.includes(itemSessionScope)) return null;
    const isRoot = item.path === "/dashboard/ai" || item.path === "/dashboard/writer" || item.path === "/dashboard/image-assistant";
    const isCurrentAgent = Boolean(itemSessionScope && itemSessionScope === activeSessionScope);
    const isFallbackAgent = isRoot && Boolean(activeSessionScope) && !hasMatchingSessionNav;
    const shouldShow = !collapsed && assistantSessionsExpanded && isWorkbenchSessionPath(activePath) && (isCurrentAgent || (isRoot && (!activeSessionScope || isFallbackAgent)));
    if (!shouldShow) return null;
    const visibleSessions = itemSessionScope || isFallbackAgent || activeSessionAgentId
      ? sessions.filter((session) => session.agentId === (itemSessionScope ?? activeSessionAgentId ?? activeSessionScope))
      : sessions.filter((session) => !session.agentId);
    const sessionTitle = itemSessionScope || isFallbackAgent ? (isCurrentAgent || isFallbackAgent ? activeSessionAgentLabel ?? item.label : item.label) : sessionsLabel ?? toggleCopy.recent;
    const showSessionHeading = !itemSessionScope && !isFallbackAgent;
    return <section className="wb-sidebar-sessions" aria-label={sessionTitle}>
      {showSessionHeading ? <div className="wb-sidebar-session-heading">{sessionTitle}</div> : null}
      {onNewSession ? <button type="button" className="wb-sidebar-session-create" onClick={onNewSession} aria-label={newSessionLabel ?? toggleCopy.newSession} title={newSessionLabel ?? toggleCopy.newSession}><span aria-hidden="true">＋</span>{newSessionLabel ?? toggleCopy.newSession}</button> : null}
      {visibleSessions.length ? <div className="wb-sidebar-session-list">{visibleSessions.slice(0, 30).map((session) => {
        const isActive = session.path === activePath;
        const statusLabel = session.status === "running" ? (locale === "zh" ? "运行中" : "Running") : session.updatedAt;
        return <button key={session.path} type="button" className={`wb-sidebar-session ${isActive ? "wb-sidebar-session-active" : ""}`.trim()} onClick={() => onNavigate(session.path)} aria-current={isActive ? "page" : undefined} title={session.title}><span>{session.status === "running" ? <i className="wb-sidebar-session-status" aria-label={statusLabel} /> : null}{session.title}</span>{statusLabel ? <small>{statusLabel}</small> : null}</button>;
      })}</div> : <div className="wb-sidebar-session-empty">{toggleCopy.empty}</div>}
    </section>;
  };
  let lastSection: string | undefined;
  return (
    <WorkbenchShellFrame className={`wb-shell ${collapsed ? "wb-shell-collapsed" : ""}`.trim()}>
      <aside className="wb-sidebar">
        <div className="wb-sidebar-head">
          <div className="wb-sidebar-brand"><span className="wb-brand-mark">AI</span>{!collapsed ? <span className="wb-brand-title">{title}</span> : null}</div>
          <div className={`wb-sidebar-toolbar ${collapsed ? "wb-sidebar-toolbar-collapsed" : ""}`.trim()}>
            {(onLocaleChange || onLocaleToggle) ? <div className="wb-locale-switcher" role="group" aria-label={locale === "zh" ? "界面语言" : "Interface language"}>{!collapsed ? <span className="wb-locale-globe" aria-hidden="true">◉</span> : null}<button type="button" className={`wb-locale-option ${locale === "zh" ? "is-active" : ""}`.trim()} onClick={() => onLocaleChange ? onLocaleChange("zh") : (locale === "zh" ? undefined : onLocaleToggle?.())} aria-pressed={locale === "zh"} aria-label={locale === "zh" ? "切换到中文" : "Switch to Chinese"} title={locale === "zh" ? "切换到中文" : "Switch to Chinese"}>{collapsed ? "中" : "中文"}</button><button type="button" className={`wb-locale-option ${locale === "en" ? "is-active" : ""}`.trim()} onClick={() => onLocaleChange ? onLocaleChange("en") : (locale === "en" ? undefined : onLocaleToggle?.())} aria-pressed={locale === "en"} aria-label={locale === "en" ? "Switch to English" : "切换到英文"} title={locale === "en" ? "Switch to English" : "切换到英文"}>EN</button></div> : null}
            <button type="button" className="wb-sidebar-toggle" aria-label={collapsed ? toggleCopy.expand : toggleCopy.collapse} title={collapsed ? toggleCopy.expand : toggleCopy.collapse} onClick={onToggleCollapsed}><span className="wb-sidebar-toggle-icon" aria-hidden="true">{collapsed ? "›" : "‹"}</span></button>
          </div>
          {!collapsed && localLabel ? <div className="wb-sidebar-context-label">{localLabel}</div> : null}
        </div>
        <div className="wb-sidebar-scroll">
          <nav className="wb-sidebar-nav" aria-label={toggleCopy.navigation}>
            {mainNavItems.map((item) => {
              const isActive = isWorkbenchNavItemActive(item.path, activePath, navPaths);
              const isAssistantRoot = item.path === "/dashboard/ai";
              const isAssistantEntry = item.path.startsWith("/dashboard/ai");
              const isSessionRoot = item.path === "/dashboard/ai" || item.path === "/dashboard/writer" || item.path === "/dashboard/image-assistant";
              const itemSessionScope = workbenchSessionScope(item.path);
              const sessionScopeHidden = Boolean(itemSessionScope && hideSessionScopes.includes(itemSessionScope));
              const sessionNavigationEnabled = !sessionScopeHidden && (isSessionRoot || Boolean(itemSessionScope));
              const sessionItemMatches = itemSessionScope ? itemSessionScope === activeSessionScope : !activeSessionScope || !hasMatchingSessionNav;
              const assistantHighlighted = (isAssistantRoot && !activeSessionScope && isWorkbenchSessionPath(activePath)) || (itemSessionScope && itemSessionScope === activeSessionScope) || (isActive && isAssistantEntry && !(isAssistantRoot && activeSessionScope));
              const showSection = Boolean(item.section && !collapsed && item.section !== lastSection);
              if (item.section) lastSection = item.section;
              return <div key={item.path}>
            {showSection ? <h3 className="wb-nav-section">{item.section}</h3> : null}
            <button type="button" className={`wb-nav-item ${isActive || assistantHighlighted ? "wb-nav-item-active" : ""} ${assistantHighlighted ? "wb-nav-item-active-assistant" : ""}`.trim()} title={item.label} aria-label={item.label} aria-current={isActive ? "page" : undefined} aria-expanded={sessionNavigationEnabled ? (!collapsed && assistantSessionsExpanded && isWorkbenchSessionPath(activePath) && sessionItemMatches) : undefined} data-agent-nav={item.label} onClick={() => { if (!sessionNavigationEnabled) { onNavigate(item.path); return; } if (isWorkbenchSessionPath(activePath) && sessionItemMatches) { setAssistantSessionsExpanded((current) => !current); return; } setAssistantSessionsExpanded(true); onNavigate(item.path); }}><span className="wb-nav-glyph" aria-hidden="true">{item.icon ?? item.glyph ?? item.label.slice(0, 1)}</span>{!collapsed ? <span className="wb-nav-label">{item.label}</span> : null}{sessionNavigationEnabled && !collapsed ? <span className="wb-nav-expander" aria-hidden="true">{assistantSessionsExpanded && isWorkbenchSessionPath(activePath) && sessionItemMatches ? "⌄" : "›"}</span> : null}</button>
            {renderSessionSection(item)}
          </div>;
            })}
          </nav>
        </div>
        <div className="wb-sidebar-footer">{footerNavItems.length ? <div className="wb-sidebar-footer-nav">{footerNavItems.map((item) => <button key={item.path} type="button" className={`wb-nav-item ${item.path === activePath ? "wb-nav-item-active" : ""}`.trim()} title={item.label} aria-label={item.label} aria-current={item.path === activePath ? "page" : undefined} data-agent-nav={item.label} onClick={() => onNavigate(item.path)}><span className="wb-nav-glyph" aria-hidden="true">{item.icon ?? item.glyph ?? item.label.slice(0, 1)}</span>{!collapsed ? <span className="wb-nav-label">{item.label}</span> : null}</button>)}</div> : null}{!collapsed && status ? <div className="wb-status">{status}</div> : null}</div>
      </aside>
      <main className="wb-shell-main">{children}</main>
    </WorkbenchShellFrame>
  );
}
