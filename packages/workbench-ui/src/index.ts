export type WorkbenchSurface = "conversation" | "workflow" | "media" | "artifacts" | "usage";
export * from "./components";
export * from "./agent-directory";
export * from "./agent-catalog";
export * from "./capability-center";
export * from "./provider-catalog";
export * from "./media";
export * from "./message-timeline";
export * from "./message-time";
export * from "./workbench-message-surface";
export * from "./prompt-input";
export * from "./process-parts";
export * from "./ai-elements/index";
export * from "./adapters";
export * from "./routes";
export * from "./route-icon";
export * from "./writer";
export * from "./workflow-directory";
export * from "./workflow-canvas";
export * from "./workflow-parameter-fields";
export * from "./workflow-ai-sidebar";
export * from "./task-status";
export { WorkflowCanvas as WorkbenchWorkflowCanvas } from "./workflow-canvas";

/** Visual contract shared by the online command-center and the desktop adapter. */
export const WORKBENCH_THEME = {
  light: {
    brandYellow: "#ffd000",
    brandYellowReference: "#F4F254",
    background: "#fdfdfb",
    foreground: "#111111",
    card: "#ffffff",
    cardForeground: "#111111",
    popover: "#ffffff",
    popoverForeground: "#111111",
    primary: "#ffd000",
    primaryForeground: "#111111",
    secondary: "#111111",
    secondaryForeground: "#ffffff",
    muted: "#efefea",
    mutedForeground: "#777777",
    accent: "#161616",
    accentForeground: "#ffd000",
    destructive: "#d4183d",
    destructiveForeground: "#ffffff",
    border: "#e5e5e0",
    input: "#e5e5e0",
    inputBackground: "#ffffff",
    ring: "#ffd000",
    chart1: "#ffd000",
    chart2: "#111111",
    chart3: "#111111",
    chart4: "#e5e5e0",
    chart5: "#8a8a8a",
    radius: "0.75rem",
    sidebar: "#ffffff",
    sidebarForeground: "#111111",
    sidebarPrimary: "#ffd000",
    sidebarPrimaryForeground: "#111111",
    sidebarAccent: "#fdfdfb",
    sidebarAccentForeground: "#111111",
    sidebarBorder: "#e5e5e0",
    sidebarRing: "#ffd000",
    gridLine: "rgba(17, 17, 17, 0.011)",
    dashboardGridLine: "rgba(17, 17, 17, 0.008)",
  },
  dark: {
    brandYellow: "#ffd21a",
    brandYellowReference: "#F4F254",
    background: "#141414",
    foreground: "#f5f5f5",
    card: "#1a1a1a",
    cardForeground: "#f5f5f5",
    popover: "#1a1a1a",
    popoverForeground: "#f5f5f5",
    primary: "#ffd21a",
    primaryForeground: "#1a1a1a",
    secondary: "#f5f5f5",
    secondaryForeground: "#1a1a1a",
    muted: "#262626",
    mutedForeground: "#b5b5b5",
    accent: "#f5f5f5",
    accentForeground: "#1a1a1a",
    destructive: "#ff557a",
    destructiveForeground: "#140408",
    border: "rgba(245, 245, 245, 0.12)",
    input: "#2d2d2d",
    inputBackground: "#1f1f1f",
    ring: "#ffd21a",
    chart1: "#ffd21a",
    chart2: "#f5f5f5",
    chart3: "#f5f5f5",
    chart4: "#525252",
    chart5: "#d3d3d3",
    radius: "0.75rem",
    sidebar: "#161616",
    sidebarForeground: "#f5f5f5",
    sidebarPrimary: "#ffd21a",
    sidebarPrimaryForeground: "#1a1a1a",
    sidebarAccent: "#1f1f1f",
    sidebarAccentForeground: "#f5f5f5",
    sidebarBorder: "rgba(245, 245, 245, 0.1)",
    sidebarRing: "#ffd21a",
    gridLine: "rgba(245, 245, 245, 0.022)",
    dashboardGridLine: "rgba(245, 245, 245, 0.016)",
  },
  typography: {
    body: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    display: '"Barlow Condensed", "Arial Narrow", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  },
  message: {
    maxWidth: "64rem",
    avatarSize: "2.25rem",
    avatarRadius: "6px",
    rowPadding: "0.875rem 1rem",
  },
} as const;

// Kept in lockstep with components/workspace/workspace-message-primitives.tsx
// so the Tauri surface uses the same message geometry as the online workbench.
export const WORKBENCH_MESSAGE_FRAME = {
  maxWidth: "64rem",
  rowPadding: "14px 16px",
  gap: "12px",
  avatarSize: "36px",
  avatarRadius: "6px",
  labelSize: "13px",
  bodySize: "14px",
  bodyLineHeight: "1.75",
  eventSize: "12px",
} as const;
