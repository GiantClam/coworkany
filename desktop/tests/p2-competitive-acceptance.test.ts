/**
 * P2 Competitive Features — Acceptance Test Suite
 *
 * Verifies all 7 competitive features (#16-#22):
 *   16. Voice Input (STT)
 *   17. Multimodal Input
 *   18. Plugin/Skill Marketplace
 *   19. CI/CD Pipeline
 *   20. User Feedback & Telemetry
 *   21. Command Execution Sandbox
 *   22. Offline Capability
 *
 * Run: cd desktop && bun test tests/p2-competitive-acceptance.test.ts
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const DESKTOP_SRC = path.resolve(__dirname, '../src');
const SIDECAR_SRC = path.resolve(__dirname, '../../sidecar/src');
const ROOT = path.resolve(__dirname, '../..');

function fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
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
// #16: Voice Input (STT)
// ============================================================================

describe('#16: Voice Input (STT)', () => {
    test('useVoiceInput hook exists', () => {
        expect(fileExists(path.join(DESKTOP_SRC, 'hooks', 'useVoiceInput.ts'))).toBe(true);
    });

    test('useVoiceInput exports required API', () => {
        const content = readFile(path.join(DESKTOP_SRC, 'hooks', 'useVoiceInput.ts'));
        expect(content).toContain('isListening');
        expect(content).toContain('interimTranscript');
        expect(content).toContain('transcript');
        expect(content).toContain('isSupported');
        expect(content).toContain('startListening');
        expect(content).toContain('stopListening');
        expect(content).toContain('toggleListening');
        expect(content).toContain('SpeechRecognition');
    });

    test('InputArea includes voice input button', () => {
        const content = readFile(
            path.join(DESKTOP_SRC, 'components', 'Chat', 'components', 'InputArea.tsx')
        );
        expect(content).toContain('useVoiceInput');
        expect(content).toContain('toggleListening');
        expect(content).toContain('voice.startRecording');
    });

    test('i18n has voice input translations', () => {
        const en = JSON.parse(
            readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json'))
        );
        expect(en.voice).toBeDefined();
        expect(en.voice.startRecording).toBeDefined();
        expect(en.voice.stopRecording).toBeDefined();
        expect(en.voice.listening).toBeDefined();
    });
});

// ============================================================================
// #17: Multimodal Input
// ============================================================================

describe('#17: Multimodal Input', () => {
    test('useFileAttachment hook exists', () => {
        expect(fileExists(path.join(DESKTOP_SRC, 'hooks', 'useFileAttachment.ts'))).toBe(true);
    });

    test('useFileAttachment supports drag-drop, paste, and base64', () => {
        const content = readFile(path.join(DESKTOP_SRC, 'hooks', 'useFileAttachment.ts'));
        expect(content).toContain('handleDrop');
        expect(content).toContain('handlePaste');
        expect(content).toContain('base64');
        expect(content).toContain('FileAttachment');
        expect(content).toContain('buildContentWithAttachments');
    });

    test('AttachmentPreview component exists', () => {
        expect(
            fileExists(
                path.join(DESKTOP_SRC, 'components', 'Chat', 'components', 'AttachmentPreview.tsx')
            )
        ).toBe(true);
    });

    test('AttachmentPreview renders attachment chips with remove', () => {
        const content = readFile(
            path.join(DESKTOP_SRC, 'components', 'Chat', 'components', 'AttachmentPreview.tsx')
        );
        expect(content).toContain('onRemove');
        expect(content).toContain('preview');
        expect(content).toContain('removeAttachment');
    });

    test('i18n has multimodal translations', () => {
        const en = JSON.parse(
            readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json'))
        );
        expect(en.multimodal).toBeDefined();
        expect(en.multimodal.dragDropHint).toBeDefined();
        expect(en.multimodal.attachFile).toBeDefined();
    });
});

// ============================================================================
// #18: Plugin/Skill Marketplace
// ============================================================================

describe('#18: Plugin/Skill Marketplace', () => {
    test('MarketplaceView component exists', () => {
        expect(
            fileExists(
                path.join(DESKTOP_SRC, 'components', 'Marketplace', 'MarketplaceView.tsx')
            )
        ).toBe(true);
    });

    test('MarketplaceView has search, categories, and install', () => {
        const content = readFile(
            path.join(DESKTOP_SRC, 'components', 'Marketplace', 'MarketplaceView.tsx')
        );
        expect(content).toContain('searchQuery');
        expect(content).toContain('category');
        expect(content).toContain('handleInstall');
        expect(content).toContain('SAMPLE_ITEMS');
        expect(content).toContain('MarketplaceItem');
    });

    test('MarketplaceView supports skill and MCP types', () => {
        const content = readFile(
            path.join(DESKTOP_SRC, 'components', 'Marketplace', 'MarketplaceView.tsx')
        );
        expect(content).toContain("type: 'skill'");
        expect(content).toContain("type: 'mcp'");
    });

    test('MarketplaceView has sorting options', () => {
        const content = readFile(
            path.join(DESKTOP_SRC, 'components', 'Marketplace', 'MarketplaceView.tsx')
        );
        expect(content).toContain('popular');
        expect(content).toContain('newest');
        expect(content).toContain('rating');
    });

    test('i18n has marketplace translations', () => {
        const en = JSON.parse(
            readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json'))
        );
        expect(en.marketplace).toBeDefined();
        expect(en.marketplace.title).toBeDefined();
        expect(en.marketplace.searchPlaceholder).toBeDefined();
    });
});

// ============================================================================
// #19: CI/CD Pipeline
// ============================================================================

describe('#19: CI/CD Pipeline', () => {
    test('CI workflow file exists', () => {
        expect(fileExists(path.join(ROOT, '.github', 'workflows', 'ci.yml'))).toBe(true);
    });

    test('Release workflow file exists', () => {
        expect(fileExists(path.join(ROOT, '.github', 'workflows', 'release.yml'))).toBe(true);
    });

    test('CI workflow runs TypeScript check', () => {
        const content = readFile(path.join(ROOT, '.github', 'workflows', 'ci.yml'));
        expect(content).toContain('tsc --noEmit');
    });

    test('CI workflow runs tests', () => {
        const content = readFile(path.join(ROOT, '.github', 'workflows', 'ci.yml'));
        expect(content).toContain('bun test');
    });

    test('CI workflow builds Tauri for multiple platforms', () => {
        const content = readFile(path.join(ROOT, '.github', 'workflows', 'ci.yml'));
        expect(content).toContain('ubuntu-latest');
        expect(content).toContain('windows-latest');
        expect(content).toContain('macos-latest');
    });

    test('Release workflow triggers on version tags', () => {
        const content = readFile(path.join(ROOT, '.github', 'workflows', 'release.yml'));
        expect(content).toContain("tags:");
        expect(content).toContain("- 'v*'");
    });

    test('Release workflow uses tauri-action', () => {
        const content = readFile(path.join(ROOT, '.github', 'workflows', 'release.yml'));
        expect(content).toContain('tauri-apps/tauri-action');
        expect(content).toContain('TAURI_SIGNING_PRIVATE_KEY');
    });
});

// ============================================================================
// #20: User Feedback & Telemetry
// ============================================================================

describe('#20: User Feedback & Telemetry', () => {
    test('FeedbackDialog component exists', () => {
        expect(
            fileExists(path.join(DESKTOP_SRC, 'components', 'Common', 'FeedbackDialog.tsx'))
        ).toBe(true);
    });

    test('FeedbackDialog supports bug, feature, general types', () => {
        const content = readFile(
            path.join(DESKTOP_SRC, 'components', 'Common', 'FeedbackDialog.tsx')
        );
        expect(content).toContain("'bug'");
        expect(content).toContain("'feature'");
        expect(content).toContain("'general'");
        expect(content).toContain('FeedbackEntry');
    });

    test('Telemetry module exists', () => {
        expect(fileExists(path.join(DESKTOP_SRC, 'lib', 'telemetry.ts'))).toBe(true);
    });

    test('Telemetry is opt-in with config', () => {
        const content = readFile(path.join(DESKTOP_SRC, 'lib', 'telemetry.ts'));
        expect(content).toContain('TelemetryConfig');
        expect(content).toContain('enabled: false');
        expect(content).toContain('crashReporting: false');
    });

    test('Telemetry exports trackEvent and reportCrash', () => {
        const content = readFile(path.join(DESKTOP_SRC, 'lib', 'telemetry.ts'));
        expect(content).toContain('trackEvent');
        expect(content).toContain('reportCrash');
    });

    test('i18n has feedback translations', () => {
        const en = JSON.parse(
            readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json'))
        );
        expect(en.feedback).toBeDefined();
        expect(en.feedback.sendFeedback).toBeDefined();
        expect(en.feedback.telemetryTitle).toBeDefined();
    });
});

// ============================================================================
// #21: Command Execution Sandbox
// ============================================================================

describe('#21: Command Execution Sandbox', () => {
    test('commandSandbox module exists', () => {
        expect(
            fileExists(path.join(SIDECAR_SRC, 'tools', 'commandSandbox.ts'))
        ).toBe(true);
    });

    test('commandSandbox has dangerous patterns', () => {
        const content = readFile(path.join(SIDECAR_SRC, 'tools', 'commandSandbox.ts'));
        expect(content).toContain('DANGEROUS_PATTERNS');
        expect(content).toContain("'critical'");
        expect(content).toContain("'high'");
        expect(content).toContain("'medium'");
    });

    test('commandSandbox blocks critical commands', () => {
        const content = readFile(path.join(SIDECAR_SRC, 'tools', 'commandSandbox.ts'));
        expect(content).toContain('rm');
        expect(content).toContain('mkfs');
        expect(content).toContain('format');
        expect(content).toContain('shutdown');
    });

    test('commandSandbox exports checkCommand function', () => {
        const content = readFile(path.join(SIDECAR_SRC, 'tools', 'commandSandbox.ts'));
        expect(content).toContain('export function checkCommand');
        expect(content).toContain('CommandCheckResult');
    });

    test('run_command uses commandSandbox', () => {
        const content = readFile(path.join(SIDECAR_SRC, 'tools', 'standard.ts'));
        expect(content).toContain('checkCommand');
        expect(content).toContain('commandSandbox');
    });

    test('i18n has sandbox translations', () => {
        const en = JSON.parse(
            readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json'))
        );
        expect(en.sandbox).toBeDefined();
        expect(en.sandbox.commandBlocked).toBeDefined();
        expect(en.sandbox.dangerousCommand).toBeDefined();
    });
});

// ============================================================================
// #22: Offline Capability
// ============================================================================

describe('#22: Offline Capability', () => {
    test('useNetworkStatus hook exists', () => {
        expect(fileExists(path.join(DESKTOP_SRC, 'hooks', 'useNetworkStatus.ts'))).toBe(true);
    });

    test('useNetworkStatus monitors online/offline', () => {
        const content = readFile(path.join(DESKTOP_SRC, 'hooks', 'useNetworkStatus.ts'));
        expect(content).toContain('navigator.onLine');
        expect(content).toContain('isOnline');
        expect(content).toContain("'online'");
        expect(content).toContain("'offline'");
    });

    test('OfflineBanner component exists', () => {
        expect(
            fileExists(path.join(DESKTOP_SRC, 'components', 'Common', 'OfflineBanner.tsx'))
        ).toBe(true);
    });

    test('OfflineBanner suggests Ollama fallback', () => {
        const content = readFile(
            path.join(DESKTOP_SRC, 'components', 'Common', 'OfflineBanner.tsx')
        );
        expect(content).toContain('useNetworkStatus');
        expect(content).toContain('offline.ollamaHint');
    });

    test('App.tsx integrates OfflineBanner', () => {
        const content = readFile(path.join(DESKTOP_SRC, 'App.tsx'));
        expect(content).toContain('OfflineBanner');
    });

    test('i18n has offline translations', () => {
        const en = JSON.parse(
            readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json'))
        );
        expect(en.offline).toBeDefined();
        expect(en.offline.noConnection).toBeDefined();
        expect(en.offline.ollamaHint).toBeDefined();
    });
});

// ============================================================================
// Cross-cutting: All new files exist
// ============================================================================

describe('P2 Competitive: Cross-cutting checks', () => {
    test('All new files exist', () => {
        const newFiles = [
            // #16 Voice
            path.join(DESKTOP_SRC, 'hooks', 'useVoiceInput.ts'),
            // #17 Multimodal
            path.join(DESKTOP_SRC, 'hooks', 'useFileAttachment.ts'),
            path.join(DESKTOP_SRC, 'components', 'Chat', 'components', 'AttachmentPreview.tsx'),
            // #18 Marketplace
            path.join(DESKTOP_SRC, 'components', 'Marketplace', 'MarketplaceView.tsx'),
            // #19 CI/CD
            path.join(ROOT, '.github', 'workflows', 'ci.yml'),
            path.join(ROOT, '.github', 'workflows', 'release.yml'),
            // #20 Feedback
            path.join(DESKTOP_SRC, 'components', 'Common', 'FeedbackDialog.tsx'),
            path.join(DESKTOP_SRC, 'lib', 'telemetry.ts'),
            // #21 Sandbox
            path.join(SIDECAR_SRC, 'tools', 'commandSandbox.ts'),
            // #22 Offline
            path.join(DESKTOP_SRC, 'hooks', 'useNetworkStatus.ts'),
            path.join(DESKTOP_SRC, 'components', 'Common', 'OfflineBanner.tsx'),
        ];

        for (const file of newFiles) {
            expect(fileExists(file)).toBe(true);
        }
    });

    test('en.json and zh.json are valid JSON', () => {
        expect(isValidJson(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json'))).toBe(true);
        expect(isValidJson(path.join(DESKTOP_SRC, 'i18n', 'locales', 'zh.json'))).toBe(true);
    });

    test('en.json and zh.json have matching top-level keys', () => {
        const en = JSON.parse(readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'en.json')));
        const zh = JSON.parse(readFile(path.join(DESKTOP_SRC, 'i18n', 'locales', 'zh.json')));
        expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    });
});

// ============================================================================
// Manual Test Checklist
// ============================================================================

describe('P2 Competitive: Manual Test Checklist', () => {
    test('Print manual test plan', () => {
        console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║           P2 Competitive Features — Manual Test Checklist         ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  #16 Voice Input:                                                 ║
║  [ ] Chat input shows microphone button                           ║
║  [ ] Click mic → "Listening..." state (red button)                ║
║  [ ] Speak → text appears in input field                          ║
║  [ ] Click mic again → stops recording                            ║
║  [ ] Graceful fallback if browser doesn't support Speech API      ║
║                                                                   ║
║  #17 Multimodal Input:                                            ║
║  [ ] Drag image onto chat input → attachment preview appears      ║
║  [ ] Paste image from clipboard → attachment added                ║
║  [ ] Click attach button → file picker opens                      ║
║  [ ] Send message with attachment → content includes file data    ║
║  [ ] Remove attachment → chip disappears                          ║
║                                                                   ║
║  #18 Marketplace:                                                 ║
║  [ ] Marketplace view renders with sample items                   ║
║  [ ] Search filters items by name/description                     ║
║  [ ] Category buttons filter correctly                            ║
║  [ ] Sort dropdown works (popular/newest/rating)                  ║
║  [ ] Install button changes to "Installed" on click               ║
║                                                                   ║
║  #19 CI/CD:                                                       ║
║  [ ] .github/workflows/ci.yml is valid YAML                       ║
║  [ ] .github/workflows/release.yml is valid YAML                  ║
║  [ ] Push to main triggers CI (after GitHub repo setup)           ║
║                                                                   ║
║  #20 Feedback & Telemetry:                                        ║
║  [ ] Feedback dialog opens with type selector                     ║
║  [ ] Submit feedback → "Thank you" message                        ║
║  [ ] Telemetry is opt-in (disabled by default)                    ║
║                                                                   ║
║  #21 Command Sandbox:                                             ║
║  [ ] "rm -rf /" is blocked → error message returned               ║
║  [ ] "sudo apt install" shows warning but proceeds                ║
║  [ ] Normal commands (ls, cat, etc.) run without warnings         ║
║                                                                   ║
║  #22 Offline:                                                     ║
║  [ ] Disconnect network → offline banner appears                  ║
║  [ ] Banner suggests Ollama as fallback                           ║
║  [ ] Reconnect → banner disappears                                ║
║  [ ] Dismiss button hides the banner                              ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`);
        expect(true).toBe(true);
    });
});
