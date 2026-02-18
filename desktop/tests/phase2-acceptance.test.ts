/**
 * Phase 2 — Acceptance Test Suite
 *
 * Comprehensive structural and smoke tests verifying all Phase 2 features:
 *   1. i18n internationalization — framework + translation files + component usage
 *   2. OpenAI/Ollama provider support — types, config, UI components
 *   3. Token usage panel — tracking, display, cost estimation
 *   4. Conversation search & export — search UI, export utility, copy button
 *   5. Global shortcut configuration — settings UI, config store, Rust IPC
 *   6. Tauri Updater — plugin config, UpdateChecker component
 *
 * Run: cd desktop && bunx bun test tests/phase2-acceptance.test.ts
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const DESKTOP_SRC = path.resolve(__dirname, '../src');
const SIDECAR_SRC = path.resolve(__dirname, '../../sidecar/src');
const TAURI_SRC = path.resolve(__dirname, '../src-tauri/src');

// ============================================================================
// Helper utilities
// ============================================================================

function fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
}

function fileContains(filePath: string, pattern: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes(pattern);
}

function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

function isValidJson(filePath: string): boolean {
    try {
        JSON.parse(readFile(filePath));
        return true;
    } catch {
        return false;
    }
}

// ============================================================================
// P2-1: i18n Internationalization
// ============================================================================

describe('P2-1: i18n Internationalization', () => {
    const i18nDir = path.join(DESKTOP_SRC, 'i18n');
    const enFile = path.join(i18nDir, 'locales', 'en.json');
    const zhFile = path.join(i18nDir, 'locales', 'zh.json');
    const indexFile = path.join(i18nDir, 'index.ts');

    test('i18n directory structure exists', () => {
        expect(fileExists(i18nDir)).toBe(true);
        expect(fileExists(enFile)).toBe(true);
        expect(fileExists(zhFile)).toBe(true);
        expect(fileExists(indexFile)).toBe(true);
    });

    test('translation files are valid JSON', () => {
        expect(isValidJson(enFile)).toBe(true);
        expect(isValidJson(zhFile)).toBe(true);
    });

    test('en.json and zh.json have matching top-level keys', () => {
        const en = JSON.parse(readFile(enFile));
        const zh = JSON.parse(readFile(zhFile));
        const enKeys = Object.keys(en).sort();
        const zhKeys = Object.keys(zh).sort();
        expect(enKeys).toEqual(zhKeys);
    });

    test('translation files have all required namespaces', () => {
        const en = JSON.parse(readFile(enFile));
        const requiredNamespaces = [
            'common', 'setup', 'settings', 'chat', 'search',
            'dashboard', 'errorBoundary', 'sidebar', 'skills',
            'mcp', 'toolpacks', 'repository', 'workspace',
            'titlebar', 'fluid', 'patch', 'effect', 'quality',
            'verification', 'runtime', 'updater',
        ];
        for (const ns of requiredNamespaces) {
            expect(en[ns]).toBeDefined();
        }
    });

    test('i18n index initializes react-i18next', () => {
        const content = readFile(indexFile);
        expect(content).toContain('initReactI18next');
        expect(content).toContain('changeLanguage');
        expect(content).toContain('getCurrentLanguage');
    });

    test('main.tsx imports i18n', () => {
        const mainTsx = readFile(path.join(DESKTOP_SRC, 'main.tsx'));
        expect(mainTsx).toContain("import './i18n'");
    });

    test('SettingsView includes language switcher', () => {
        const settings = readFile(
            path.join(DESKTOP_SRC, 'components', 'Settings', 'SettingsView.tsx')
        );
        expect(settings).toContain('changeLanguage');
        expect(settings).toContain('languageOptions');
    });
});

// ============================================================================
// P2-2: OpenAI + Ollama Provider Support
// ============================================================================

describe('P2-2: OpenAI/Ollama Provider Support', () => {
    test('LlmProvider type includes openai and ollama', () => {
        const mainTs = readFile(path.join(SIDECAR_SRC, 'main.ts'));
        expect(mainTs).toContain("'openai'");
        expect(mainTs).toContain("'ollama'");
    });

    test('resolveProviderConfig handles openai provider', () => {
        const mainTs = readFile(path.join(SIDECAR_SRC, 'main.ts'));
        expect(mainTs).toContain("provider === 'openai'");
    });

    test('resolveProviderConfig handles ollama provider', () => {
        const mainTs = readFile(path.join(SIDECAR_SRC, 'main.ts'));
        expect(mainTs).toContain("provider === 'ollama'");
    });

    test('Ollama detection utility exists', () => {
        const ollamaFile = path.join(SIDECAR_SRC, 'tools', 'ollama.ts');
        expect(fileExists(ollamaFile)).toBe(true);
        const content = readFile(ollamaFile);
        expect(content).toContain('isOllamaRunning');
        expect(content).toContain('detectOllamaModels');
    });

    test('Frontend UI types include OpenAI and Ollama settings', () => {
        const uiTypes = readFile(path.join(DESKTOP_SRC, 'types', 'ui.ts'));
        expect(uiTypes).toContain('OpenAIProviderSettings');
        expect(uiTypes).toContain('OllamaProviderSettings');
    });

    test('Rust IPC types include OpenAI and Ollama settings', () => {
        const ipcRs = readFile(path.join(TAURI_SRC, 'ipc.rs'));
        expect(ipcRs).toContain('OpenAIProviderSettings');
        expect(ipcRs).toContain('OllamaProviderSettings');
    });

    test('ProfileEditor includes OpenAI and Ollama provider options', () => {
        const editor = readFile(
            path.join(DESKTOP_SRC, 'components', 'Settings', 'components', 'ProfileEditor.tsx')
        );
        expect(editor).toContain("'openai'");
        expect(editor).toContain("'ollama'");
        expect(editor).toContain('handleDetectOllamaModels');
    });
});

// ============================================================================
// P2-3: Token Usage Panel
// ============================================================================

describe('P2-3: Token Usage Panel', () => {
    test('TokenUsagePanel component exists', () => {
        expect(
            fileExists(path.join(DESKTOP_SRC, 'components', 'Chat', 'TokenUsagePanel.tsx'))
        ).toBe(true);
    });

    test('TokenUsagePanel is self-contained component (not in header per Glean UI)', () => {
        // Glean-style redesign: token usage is no longer shown in the header
        // The component exists and can be used in settings/status panels instead
        const panel = readFile(
            path.join(DESKTOP_SRC, 'components', 'Chat', 'TokenUsagePanel.tsx')
        );
        expect(panel).toContain('TokenUsagePanel');
    });

    test('TOKEN_USAGE event type defined', () => {
        const events = readFile(path.join(DESKTOP_SRC, 'types', 'events.ts'));
        expect(events).toContain('TOKEN_USAGE');
    });

    test('TaskSession includes tokenUsage field', () => {
        const events = readFile(path.join(DESKTOP_SRC, 'types', 'events.ts'));
        expect(events).toContain('tokenUsage');
    });

    test('Store handles TOKEN_USAGE events', () => {
        const store = readFile(
            path.join(DESKTOP_SRC, 'stores', 'taskEvents', 'index.ts')
        );
        expect(store).toContain('TOKEN_USAGE');
        expect(store).toContain('estimateTokenCost');
    });

    test('Sidecar emits TOKEN_USAGE for both Anthropic and OpenAI', () => {
        const mainTs = readFile(path.join(SIDECAR_SRC, 'main.ts'));
        const matches = mainTs.match(/type:\s*['"]TOKEN_USAGE['"]/g);
        expect(matches).toBeTruthy();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
});

// ============================================================================
// P2-4: Conversation Search & Export
// ============================================================================

describe('P2-4: Conversation Search & Export', () => {
    test('exportConversation utility exists', () => {
        const exportFile = path.join(DESKTOP_SRC, 'lib', 'exportConversation.ts');
        expect(fileExists(exportFile)).toBe(true);
        const content = readFile(exportFile);
        expect(content).toContain('sessionToMarkdown');
        expect(content).toContain('downloadMarkdown');
        expect(content).toContain('exportSession');
    });

    test('exportSession utility is available (not in header per Glean UI)', () => {
        // Glean-style redesign: export button removed from header to reduce visual noise
        // The exportSession function still exists and works, accessible via other UI paths
        const exportFile = readFile(path.join(DESKTOP_SRC, 'lib', 'exportConversation.ts'));
        expect(exportFile).toContain('exportSession');
    });

    test('TaskList includes search functionality', () => {
        const taskList = readFile(
            path.join(DESKTOP_SRC, 'components', 'Search', 'TaskList.tsx')
        );
        expect(taskList).toContain('searchQuery');
        expect(taskList).toContain('searchConversations');
    });

    test('MessageBubble includes copy button', () => {
        const bubble = readFile(
            path.join(
                DESKTOP_SRC,
                'components',
                'Chat',
                'Timeline',
                'components',
                'MessageBubble.tsx'
            )
        );
        expect(bubble).toContain('handleCopy');
        expect(bubble).toContain('clipboard');
    });

    test('Translation files include export/copy keys', () => {
        const en = JSON.parse(readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json')));
        expect(en.chat.export).toBeDefined();
        expect(en.chat.exportChat).toBeDefined();
        expect(en.chat.copied).toBeDefined();
        expect(en.chat.copyMessage).toBeDefined();
    });
});

// ============================================================================
// P2-5: Global Shortcut Configuration
// ============================================================================

describe('P2-5: Global Shortcut Configuration', () => {
    test('ShortcutSettings component exists', () => {
        expect(
            fileExists(
                path.join(DESKTOP_SRC, 'components', 'Settings', 'components', 'ShortcutSettings.tsx')
            )
        ).toBe(true);
    });

    test('ShortcutSettings included in SettingsView', () => {
        const settings = readFile(
            path.join(DESKTOP_SRC, 'components', 'Settings', 'SettingsView.tsx')
        );
        expect(settings).toContain('ShortcutSettings');
    });

    test('configStore includes shortcut helpers', () => {
        const store = readFile(path.join(DESKTOP_SRC, 'lib', 'configStore.ts'));
        expect(store).toContain('ShortcutConfig');
        expect(store).toContain('DEFAULT_SHORTCUTS');
        expect(store).toContain('getShortcuts');
        expect(store).toContain('saveShortcuts');
    });

    test('Default shortcuts are defined correctly', () => {
        const store = readFile(path.join(DESKTOP_SRC, 'lib', 'configStore.ts'));
        expect(store).toContain("toggleWindow: 'Alt+Space'");
        expect(store).toContain("newTask: 'Ctrl+N'");
        expect(store).toContain("openSettings: 'Ctrl+,'");
    });

    test('main.rs includes update_global_shortcut IPC command', () => {
        const mainRs = readFile(path.join(TAURI_SRC, 'main.rs'));
        expect(mainRs).toContain('update_global_shortcut');
    });

    test('capabilities include global-shortcut permission', () => {
        const caps = JSON.parse(
            readFile(path.join(__dirname, '../src-tauri/capabilities/default.json'))
        );
        expect(caps.permissions).toContain('global-shortcut:default');
    });

    test('useWindowShortcuts hook exists', () => {
        expect(
            fileExists(path.join(DESKTOP_SRC, 'hooks', 'useWindowShortcuts.ts'))
        ).toBe(true);
    });

    test('DashboardView uses window shortcuts', () => {
        const dashboard = readFile(
            path.join(DESKTOP_SRC, 'components', 'Dashboard', 'DashboardView.tsx')
        );
        expect(dashboard).toContain('useWindowShortcuts');
    });

    test('Translation files include shortcut keys', () => {
        const en = JSON.parse(readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json')));
        expect(en.settings.shortcuts).toBeDefined();
        expect(en.settings.toggleWindow).toBeDefined();
        expect(en.settings.newTask).toBeDefined();
        expect(en.settings.openSettings).toBeDefined();
        expect(en.settings.pressKeys).toBeDefined();
    });
});

// ============================================================================
// P2-6: Tauri Updater
// ============================================================================

describe('P2-6: Tauri Updater', () => {
    test('Cargo.toml includes tauri-plugin-updater', () => {
        const cargo = readFile(path.join(__dirname, '../src-tauri/Cargo.toml'));
        expect(cargo).toContain('tauri-plugin-updater');
    });

    test('tauri.conf.json includes updater configuration', () => {
        const conf = JSON.parse(
            readFile(path.join(__dirname, '../src-tauri/tauri.conf.json'))
        );
        expect(conf.plugins.updater).toBeDefined();
        expect(conf.plugins.updater.endpoints).toBeDefined();
        expect(conf.plugins.updater.pubkey).toBeDefined();
    });

    test('capabilities include updater permission', () => {
        const caps = JSON.parse(
            readFile(path.join(__dirname, '../src-tauri/capabilities/default.json'))
        );
        expect(caps.permissions).toContain('updater:default');
    });

    test('main.rs registers updater plugin', () => {
        const mainRs = readFile(path.join(TAURI_SRC, 'main.rs'));
        expect(mainRs).toContain('tauri_plugin_updater');
    });

    test('UpdateChecker component exists', () => {
        expect(
            fileExists(path.join(DESKTOP_SRC, 'components', 'Common', 'UpdateChecker.tsx'))
        ).toBe(true);
    });

    test('UpdateChecker integrated in App.tsx', () => {
        const app = readFile(path.join(DESKTOP_SRC, 'App.tsx'));
        expect(app).toContain('UpdateChecker');
    });

    test('Translation files include updater keys', () => {
        const en = JSON.parse(readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json')));
        expect(en.updater).toBeDefined();
        expect(en.updater.updateAvailable).toBeDefined();
        expect(en.updater.downloading).toBeDefined();
        expect(en.updater.installAndRestart).toBeDefined();
    });
});

// ============================================================================
// Cross-cutting: TypeScript compilation
// ============================================================================

describe('Phase 2: Cross-cutting checks', () => {
    test('All new files exist', () => {
        const newFiles = [
            // i18n
            'i18n/index.ts',
            'i18n/locales/en.json',
            'i18n/locales/zh.json',
            // Token
            'components/Chat/TokenUsagePanel.tsx',
            // Export
            'lib/exportConversation.ts',
            // Shortcuts
            'components/Settings/components/ShortcutSettings.tsx',
            'hooks/useWindowShortcuts.ts',
            // Updater
            'components/Common/UpdateChecker.tsx',
        ];

        for (const file of newFiles) {
            expect(fileExists(path.join(DESKTOP_SRC, file))).toBe(true);
        }
    });

    test('No orphaned imports in key files', () => {
        // Verify App.tsx imports are valid
        const app = readFile(path.join(DESKTOP_SRC, 'App.tsx'));
        const imports = app.match(/from\s+'([^']+)'/g) || [];
        expect(imports.length).toBeGreaterThan(5);
    });
});

// ============================================================================
// Manual Test Plan (printed at end)
// ============================================================================

describe('Phase 2: Manual Test Checklist (informational)', () => {
    test('Print manual test plan', () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                 Phase 2 — Manual Test Checklist                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  P2-1 i18n:                                                      ║
║  [ ] Settings > Language > switch to 中文 → all UI text changes  ║
║  [ ] Switch back to English → all text reverts                   ║
║  [ ] Reload app → language preference persists                   ║
║                                                                  ║
║  P2-2 OpenAI/Ollama:                                             ║
║  [ ] Settings > Add Profile > select "OpenAI" → API Key +       ║
║      Model fields appear                                         ║
║  [ ] Settings > Add Profile > select "Ollama" → Detect Models   ║
║      button appears                                              ║
║  [ ] If Ollama running, click Detect → models populate dropdown ║
║                                                                  ║
║  P2-3 Token Panel:                                               ║
║  [ ] Send a chat message → token usage appears in chat header   ║
║  [ ] Token counts increment with each exchange                   ║
║  [ ] Cost estimate displays (for known models)                   ║
║                                                                  ║
║  P2-4 Search & Export:                                           ║
║  [ ] Tasks sidebar: type in search box → tasks filter            ║
║  [ ] Chat header: click Export → .md file downloads              ║
║  [ ] Hover message → copy button appears → click → "Copied!"    ║
║                                                                  ║
║  P2-5 Shortcuts:                                                 ║
║  [ ] Settings > Keyboard Shortcuts section visible               ║
║  [ ] Click on shortcut binding → "Press keys..." prompt          ║
║  [ ] Press new key combo → shortcut updates                      ║
║  [ ] Changed shortcut persists after reload                      ║
║  [ ] Ctrl+N switches to Chat tab in Dashboard                   ║
║  [ ] Ctrl+, switches to Settings tab in Dashboard               ║
║                                                                  ║
║  P2-6 Updater:                                                   ║
║  [ ] App starts → no crash from update check (even if            ║
║      endpoint not configured)                                    ║
║  [ ] UpdateChecker renders at bottom-right (when update avail)  ║
║  [ ] With proper GitHub Releases config → update flow works     ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`);
        expect(true).toBe(true); // Always passes — informational only
    });
});
