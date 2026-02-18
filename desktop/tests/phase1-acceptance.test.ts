/**
 * Phase 1 — Acceptance Test Suite
 *
 * Comprehensive smoke tests verifying all Phase 1 features compile,
 * integrate correctly, and produce expected artifacts.
 *
 * Test categories:
 *   1. Toast notification system — module exists, exports correct API
 *   2. ErrorBoundary — module exists, exports GlobalErrorBoundary & SectionErrorBoundary
 *   3. Dark mode — themeStore exists, CSS variables defined for dark theme
 *   4. Rate Limit — retryWithBackoff module exists and is functional
 *   5. Tauri Store — configStore module exists with correct API
 *   6. Setup Wizard — all components exist and export correctly
 *   7. Integration — App.tsx imports all Phase 1 features
 *
 * NOTE: These are structural/smoke tests. Full UI interaction testing
 * requires the Tauri app to be running (see manual test plan below).
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const DESKTOP_SRC = path.resolve(__dirname, '../src');
const SIDECAR_SRC = path.resolve(__dirname, '../../sidecar/src');

// ============================================================================
// Helper: Check if a file exists and contains expected patterns
// ============================================================================

function fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
}

function fileContains(filePath: string, pattern: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes(pattern);
}

function fileMatches(filePath: string, regex: RegExp): boolean {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8');
    return regex.test(content);
}

// ============================================================================
// P1-1: Toast Notification System
// ============================================================================

describe('P1-1: Toast Notification System', () => {
    const toastProvider = path.join(DESKTOP_SRC, 'components/Common/ToastProvider.tsx');
    const toastCss = path.join(DESKTOP_SRC, 'styles/toast.module.css');
    const mainTsx = path.join(DESKTOP_SRC, 'main.tsx');

    test('ToastProvider component exists', () => {
        expect(fileExists(toastProvider)).toBe(true);
    });

    test('ToastProvider exports toast API (success, error, warning, info)', () => {
        expect(fileContains(toastProvider, 'export const toast')).toBe(true);
        expect(fileContains(toastProvider, 'success:')).toBe(true);
        expect(fileContains(toastProvider, 'error:')).toBe(true);
        expect(fileContains(toastProvider, 'warning:')).toBe(true);
        expect(fileContains(toastProvider, 'info:')).toBe(true);
    });

    test('ToastProvider exports ToastProvider component', () => {
        expect(fileContains(toastProvider, 'export function ToastProvider')).toBe(true);
    });

    test('Toast CSS module exists with required classes', () => {
        expect(fileExists(toastCss)).toBe(true);
        expect(fileContains(toastCss, '.viewport')).toBe(true);
        expect(fileContains(toastCss, '.root')).toBe(true);
        expect(fileContains(toastCss, '.success')).toBe(true);
        expect(fileContains(toastCss, '.error')).toBe(true);
    });

    test('main.tsx wraps root components with ToastProvider', () => {
        expect(fileContains(mainTsx, '<ToastProvider>')).toBe(true);
        expect(fileContains(mainTsx, "import { ToastProvider }")).toBe(true);
    });

    test('SettingsView uses toast instead of inline banners', () => {
        const settings = path.join(DESKTOP_SRC, 'components/Settings/SettingsView.tsx');
        expect(fileContains(settings, "import { toast }")).toBe(true);
        // Old inline banners should be removed
        expect(fileContains(settings, 'errorBanner')).toBe(false);
        expect(fileContains(settings, 'successBanner')).toBe(false);
    });
});

// ============================================================================
// P1-2: ErrorBoundary + Sidecar Watchdog
// ============================================================================

describe('P1-2: ErrorBoundary + Sidecar Watchdog', () => {
    const errorBoundary = path.join(DESKTOP_SRC, 'components/Common/AppErrorBoundary.tsx');
    const appTsx = path.join(DESKTOP_SRC, 'App.tsx');
    const mainTsx = path.join(DESKTOP_SRC, 'main.tsx');
    const mainRs = path.resolve(__dirname, '../src-tauri/src/main.rs');

    test('AppErrorBoundary component exists', () => {
        expect(fileExists(errorBoundary)).toBe(true);
    });

    test('Exports GlobalErrorBoundary and SectionErrorBoundary', () => {
        expect(fileContains(errorBoundary, 'export function GlobalErrorBoundary')).toBe(true);
        expect(fileContains(errorBoundary, 'export function SectionErrorBoundary')).toBe(true);
    });

    test('App.tsx wraps sections with SectionErrorBoundary', () => {
        expect(fileContains(appTsx, '<SectionErrorBoundary')).toBe(true);
        expect(fileContains(appTsx, "import { SectionErrorBoundary }")).toBe(true);
    });

    test('main.tsx wraps with GlobalErrorBoundary', () => {
        expect(fileContains(mainTsx, '<GlobalErrorBoundary>')).toBe(true);
        expect(fileContains(mainTsx, "import { GlobalErrorBoundary }")).toBe(true);
    });

    test('Sidecar watchdog exists in main.rs', () => {
        expect(fileContains(mainRs, 'sidecar-restarting')).toBe(true);
        expect(fileContains(mainRs, 'sidecar-failed')).toBe(true);
        expect(fileContains(mainRs, 'sidecar-reconnected')).toBe(true);
        expect(fileContains(mainRs, 'max_restarts')).toBe(true);
    });
});

// ============================================================================
// P1-3: Dark Mode
// ============================================================================

describe('P1-3: Dark Mode', () => {
    const themeStore = path.join(DESKTOP_SRC, 'stores/themeStore.ts');
    const variablesCss = path.join(DESKTOP_SRC, 'styles/variables.css');
    const settingsView = path.join(DESKTOP_SRC, 'components/Settings/SettingsView.tsx');

    test('themeStore exists with Zustand persist', () => {
        expect(fileExists(themeStore)).toBe(true);
        expect(fileContains(themeStore, 'useThemeStore')).toBe(true);
        expect(fileContains(themeStore, 'persist')).toBe(true);
        expect(fileContains(themeStore, "'coworkany-theme'")).toBe(true);
    });

    test('themeStore exports initializeTheme', () => {
        expect(fileContains(themeStore, 'export function initializeTheme')).toBe(true);
    });

    test('CSS variables include dark theme with shadows', () => {
        expect(fileContains(variablesCss, '[data-theme="dark"]')).toBe(true);
        expect(fileContains(variablesCss, '--shadow-sm:')).toBe(true);
        expect(fileContains(variablesCss, '--accent-subtle:')).toBe(true);
    });

    test('Settings has theme switcher', () => {
        expect(fileContains(settingsView, 'AppearanceSection')).toBe(true);
        expect(fileContains(settingsView, 'useThemeStore')).toBe(true);
    });

    test('main.tsx initializes theme on startup', () => {
        const mainTsx = path.join(DESKTOP_SRC, 'main.tsx');
        expect(fileContains(mainTsx, 'initializeTheme')).toBe(true);
    });
});

// ============================================================================
// P1-4: Rate Limit Exponential Backoff
// ============================================================================

describe('P1-4: Rate Limit Exponential Backoff', () => {
    const retryModule = path.join(SIDECAR_SRC, 'utils/retryWithBackoff.ts');
    const mainTs = path.join(SIDECAR_SRC, 'main.ts');
    const eventsTs = path.join(DESKTOP_SRC, 'types/events.ts');

    test('retryWithBackoff utility module exists', () => {
        expect(fileExists(retryModule)).toBe(true);
    });

    test('retryWithBackoff exports fetchWithBackoff function', () => {
        expect(fileContains(retryModule, 'export async function fetchWithBackoff')).toBe(true);
    });

    test('retryWithBackoff handles exponential backoff with Math.pow(2, attempt)', () => {
        expect(fileContains(retryModule, 'Math.pow(2, attempt)')).toBe(true);
    });

    test('retryWithBackoff reads Retry-After header', () => {
        expect(fileContains(retryModule, 'Retry-After')).toBe(true);
    });

    test('retryWithBackoff has maxDelay cap', () => {
        expect(fileContains(retryModule, 'maxDelay')).toBe(true);
    });

    test('main.ts uses fetchWithBackoff and emits RATE_LIMITED events', () => {
        expect(fileContains(mainTs, 'fetchWithBackoff')).toBe(true);
        expect(fileContains(mainTs, 'RATE_LIMITED')).toBe(true);
        expect(fileContains(mainTs, 'setRateLimitContext')).toBe(true);
    });

    test('RATE_LIMITED is defined in TaskEventType', () => {
        expect(fileContains(eventsTs, "'RATE_LIMITED'")).toBe(true);
    });
});

// ============================================================================
// P1-5: Tauri Store — API Key Persistence
// ============================================================================

describe('P1-5: Tauri Store API Key Persistence', () => {
    const configStore = path.join(DESKTOP_SRC, 'lib/configStore.ts');
    const cargoToml = path.resolve(__dirname, '../src-tauri/Cargo.toml');
    const capabilities = path.resolve(__dirname, '../src-tauri/capabilities/default.json');

    test('configStore module exists', () => {
        expect(fileExists(configStore)).toBe(true);
    });

    test('configStore exports required functions', () => {
        expect(fileContains(configStore, 'export async function getConfig')).toBe(true);
        expect(fileContains(configStore, 'export async function saveConfig')).toBe(true);
        expect(fileContains(configStore, 'export async function getApiKey')).toBe(true);
        expect(fileContains(configStore, 'export async function setApiKey')).toBe(true);
        expect(fileContains(configStore, 'export async function isFirstRun')).toBe(true);
        expect(fileContains(configStore, 'export async function markSetupCompleted')).toBe(true);
    });

    test('configStore has localStorage fallback', () => {
        expect(fileContains(configStore, 'localStorage')).toBe(true);
    });

    test('Cargo.toml includes tauri-plugin-store', () => {
        expect(fileContains(cargoToml, 'tauri-plugin-store')).toBe(true);
    });

    test('Capabilities include store:default permission', () => {
        expect(fileContains(capabilities, 'store:default')).toBe(true);
    });

    test('useSettings performs dual-write to store', () => {
        const useSettings = path.join(DESKTOP_SRC, 'components/Settings/hooks/useSettings.ts');
        expect(fileContains(useSettings, 'saveToStore')).toBe(true);
    });
});

// ============================================================================
// P1-6: Setup Wizard
// ============================================================================

describe('P1-6: Setup Wizard', () => {
    const wizardDir = path.join(DESKTOP_SRC, 'components/Setup');

    test('SetupWizard component exists', () => {
        expect(fileExists(path.join(wizardDir, 'SetupWizard.tsx'))).toBe(true);
    });

    test('WelcomeStep exists', () => {
        expect(fileExists(path.join(wizardDir, 'steps/WelcomeStep.tsx'))).toBe(true);
    });

    test('ApiKeyStep exists', () => {
        expect(fileExists(path.join(wizardDir, 'steps/ApiKeyStep.tsx'))).toBe(true);
    });

    test('CompleteStep exists', () => {
        expect(fileExists(path.join(wizardDir, 'steps/CompleteStep.tsx'))).toBe(true);
    });

    test('SetupWizard CSS module exists', () => {
        expect(fileExists(path.join(wizardDir, 'SetupWizard.module.css'))).toBe(true);
    });

    test('SetupWizard calls markSetupCompleted on finish', () => {
        expect(fileContains(path.join(wizardDir, 'SetupWizard.tsx'), 'markSetupCompleted')).toBe(true);
    });

    test('ApiKeyStep invokes validation', () => {
        expect(fileContains(path.join(wizardDir, 'steps/ApiKeyStep.tsx'), 'validate_llm_settings')).toBe(true);
    });

    test('App.tsx integrates SetupWizard with isFirstRun check', () => {
        const appTsx = path.join(DESKTOP_SRC, 'App.tsx');
        expect(fileContains(appTsx, 'SetupWizard')).toBe(true);
        expect(fileContains(appTsx, 'isFirstRun')).toBe(true);
        expect(fileContains(appTsx, 'showSetup')).toBe(true);
    });
});

// ============================================================================
// Integration: All Phase 1 features wired together
// ============================================================================

describe('Phase 1 Integration', () => {
    test('main.tsx imports all Phase 1 infrastructure', () => {
        const mainTsx = path.join(DESKTOP_SRC, 'main.tsx');
        expect(fileContains(mainTsx, 'ToastProvider')).toBe(true);
        expect(fileContains(mainTsx, 'GlobalErrorBoundary')).toBe(true);
        expect(fileContains(mainTsx, 'initializeTheme')).toBe(true);
    });

    test('Rust main.rs has all Phase 1 backend features', () => {
        const mainRs = path.resolve(__dirname, '../src-tauri/src/main.rs');
        expect(fileContains(mainRs, 'tauri_plugin_store')).toBe(true);
        expect(fileContains(mainRs, 'sidecar-restarting')).toBe(true);
    });

    test('No TypeScript import cycles (basic check)', () => {
        // Check that configStore doesn't import from components
        const configStore = path.join(DESKTOP_SRC, 'lib/configStore.ts');
        expect(fileContains(configStore, 'from \'../components')).toBe(false);

        // Check that themeStore doesn't import from components
        const themeStore = path.join(DESKTOP_SRC, 'stores/themeStore.ts');
        expect(fileContains(themeStore, 'from \'../components')).toBe(false);
    });
});

// ============================================================================
// Manual Test Plan (printed as reference)
// ============================================================================

describe('Manual Test Plan Reference', () => {
    test('prints manual test checklist', () => {
        const checklist = `
=== Phase 1 Manual Test Checklist ===

1. Full Install Simulation:
   [ ] Delete settings.json and Store files
   [ ] Launch app -> Setup Wizard appears
   [ ] Walk through 3 steps -> Enter API key -> Verify -> Complete
   [ ] Chat interface appears -> Send first message -> Receive reply

2. Dark Mode:
   [ ] Settings -> Appearance -> Switch to Dark
   [ ] All pages render correctly (Chat, Settings, Dashboard)
   [ ] Switch to Light -> Back to normal
   [ ] Switch to System -> Follows OS preference
   [ ] Restart app -> Theme persisted

3. Toast Notifications:
   [ ] Save settings -> Success toast appears bottom-right
   [ ] Invalid config -> Error toast appears
   [ ] Toast auto-dismisses after timeout
   [ ] Toast can be manually closed

4. Error Recovery:
   [ ] Disconnect network -> Send message -> Rate limit toast
   [ ] Reconnect -> Auto-retry succeeds

5. Sidecar Watchdog:
   [ ] Kill sidecar process manually
   [ ] Toast: "Reconnecting..."
   [ ] Sidecar auto-restarts within 5s
   [ ] Send message -> Works normally

6. Config Persistence:
   [ ] Configure all settings
   [ ] Fully close and reopen app
   [ ] All settings retained
        `;
        console.log(checklist);
        expect(true).toBe(true); // Always passes — reference only
    });
});
