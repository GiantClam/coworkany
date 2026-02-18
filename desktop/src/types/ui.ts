/**
 * UI Types - Unified Type Definitions
 *
 * Centralizes all UI-related type definitions used across the application.
 */

// ============================================================================
// View & Navigation Types
// ============================================================================

export type ViewMode = 'launcher' | 'panel' | 'dashboard';

export interface NavigationState {
    viewMode: ViewMode;
    isTaskWindowOpen: boolean;
    isDetailWindowOpen: boolean;
}

// ============================================================================
// Workspace Types
// ============================================================================

export interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    lastUsedAt?: string;
    defaultSkills: string[];
    defaultToolpacks: string[];
}

// ============================================================================
// LLM Configuration Types
// ============================================================================

export interface AnthropicProviderSettings {
    apiKey?: string;
    model?: string;
}

export interface OpenRouterProviderSettings {
    apiKey?: string;
    model?: string;
}

export interface OpenAIProviderSettings {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

export interface OllamaProviderSettings {
    baseUrl?: string;
    model?: string;
}

export interface CustomProviderSettings {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    apiFormat?: 'anthropic' | 'openai';
}

export interface SearchSettings {
    provider?: 'serper' | 'searxng' | 'tavily' | 'brave';
    searxngUrl?: string;
    tavilyApiKey?: string;
    braveApiKey?: string;
    serperApiKey?: string;
}

export interface LlmProfile {
    id: string;
    name: string;
    provider: 'anthropic' | 'openrouter' | 'openai' | 'ollama' | 'custom';
    anthropic?: AnthropicProviderSettings;
    openrouter?: OpenRouterProviderSettings;
    openai?: OpenAIProviderSettings;
    ollama?: OllamaProviderSettings;
    custom?: CustomProviderSettings;
    verified: boolean;
}

export interface LlmConfig {
    provider?: string;
    anthropic?: AnthropicProviderSettings;
    openrouter?: OpenRouterProviderSettings;
    openai?: OpenAIProviderSettings;
    ollama?: OllamaProviderSettings;
    custom?: CustomProviderSettings;
    profiles?: LlmProfile[];
    activeProfileId?: string;
    maxHistoryMessages?: number;
    search?: SearchSettings;
}

// ============================================================================
// IPC Result Types
// ============================================================================

export interface IpcResult<T = any> {
    success: boolean;
    payload?: T;
    error?: string;
}

// ============================================================================
// Skill & Toolpack Types
// ============================================================================

export interface SkillManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    skillPath: string;
    [key: string]: unknown;
}

export interface SkillRecord {
    manifest: SkillManifest;
    enabled: boolean;
    installedAt: string;
}

export interface ToolpackManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    tools: string[];
    [key: string]: unknown;
}

export interface ToolpackRecord {
    manifest: ToolpackManifest;
    enabled: boolean;
    installedAt: string;
}

// ============================================================================
// Form State Types
// ============================================================================

export interface FormState {
    loading: boolean;
    error: string | null;
    saved: boolean;
}

export interface ValidationMessage {
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
}

// ============================================================================
// Modal & Dialog Types
// ============================================================================

export interface ModalState {
    open: boolean;
    title?: string;
    content?: React.ReactNode;
    onClose?: () => void;
}

export interface ConfirmDialogState {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'danger';
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface BaseComponentProps {
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}

export interface FieldProps {
    label: string;
    id?: string;
    error?: string;
    required?: boolean;
    hint?: string;
    children: React.ReactNode;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    icon?: React.ReactNode;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    error?: boolean;
    fullWidth?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    error?: boolean;
    fullWidth?: boolean;
    options: Array<{ value: string; label: string }>;
}

// ============================================================================
// Timeline & Message Types
// ============================================================================

export interface MessageProcessingOptions {
    removeEmojis?: boolean;
    compactMarkdown?: boolean;
    cleanNewlines?: boolean;
}

export interface CodeBlockProps {
    language: string;
    children: string;
    showLineNumbers?: boolean;
}

export interface MarkdownRendererProps {
    content: string;
    className?: string;
    processingOptions?: MessageProcessingOptions;
}

// ============================================================================
// Status & Badge Types
// ============================================================================

export type StatusType = 'idle' | 'loading' | 'success' | 'error' | 'warning';

export interface StatusBadgeProps {
    status: StatusType;
    label?: string;
    size?: 'sm' | 'md' | 'lg';
}

// ============================================================================
// Search & Filter Types
// ============================================================================

export interface SearchState {
    query: string;
    filters: Record<string, any>;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface PaginationState {
    page: number;
    pageSize: number;
    total: number;
}

// ============================================================================
// Notification Types
// ============================================================================

export interface Notification {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message?: string;
    duration?: number;
    timestamp: string;
}

// ============================================================================
// Theme Types
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeConfig {
    mode: ThemeMode;
    accentColor?: string;
    borderRadius?: 'none' | 'sm' | 'md' | 'lg';
    fontScale?: number;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isValidationError(msg: ValidationMessage): boolean {
    return msg.type === 'error';
}

export function isValidationSuccess(msg: ValidationMessage): boolean {
    return msg.type === 'success';
}

export function hasError(state: FormState): boolean {
    return state.error !== null;
}

export function isLoading(state: FormState): boolean {
    return state.loading;
}
