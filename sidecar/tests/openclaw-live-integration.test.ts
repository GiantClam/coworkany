/**
 * Live integration validation for ClawHub + GitHub skill install flow.
 *
 * No mock server is used in this test.
 * It verifies:
 * 1) Real ClawHub search/install
 * 2) Installed skill is visible in CoworkAny skill list
 * 3) Installed tool file can be executed from CoworkAny runtime
 * 4) Uninstall works
 * 5) GitHub install/uninstall follows the same list visibility behavior
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SidecarProcess } from './helpers/sidecar-harness';
import { STANDARD_TOOLS } from '../src/tools/standard';

const LIVE_TIMEOUT_MS = 12 * 60 * 1000;
const RESPONSE_TIMEOUT_MS = 120_000;
const CLAWHUB_SKILL_SLUG = process.env.COWORKANY_LIVE_CLAWHUB_SKILL ?? 'windows-ui-automation';
const CLAWHUB_COMMAND_SKILL_SLUG = process.env.COWORKANY_LIVE_COMMAND_SKILL ?? 'zillow-airbnb-matcher';
const GITHUB_SKILL_SOURCE =
    process.env.COWORKANY_LIVE_GITHUB_SKILL_SOURCE ??
    'github:nextlevelbuilder/ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max';
const GITHUB_SKILL_ID = process.env.COWORKANY_LIVE_GITHUB_SKILL_ID ?? 'ui-ux-pro-max';

type IpcEvent = {
    type: string;
    commandId?: string;
    payload?: Record<string, unknown>;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCommandAndWait(
    sidecar: SidecarProcess,
    type: string,
    payload: Record<string, unknown>,
    responseType: string,
    timeoutMs: number = RESPONSE_TIMEOUT_MS
): Promise<IpcEvent> {
    const commandId = randomUUID();
    const startIdx = sidecar.collector.events.length;

    sidecar.sendCommand(
        JSON.stringify({
            type,
            id: commandId,
            timestamp: new Date().toISOString(),
            payload,
        })
    );

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const newEvents = sidecar.collector.events.slice(startIdx) as IpcEvent[];
        const hit = newEvents.find((event) => event.type === responseType && event.commandId === commandId);
        if (hit) {
            return hit;
        }
        await sleep(200);
    }

    throw new Error(`Timeout waiting for ${responseType} (command: ${type})`);
}

function getSkillsFromListResponse(event: IpcEvent): Array<{ manifest?: { id?: string; name?: string; metadata?: Record<string, unknown> } }> {
    const payload = event.payload ?? {};
    const skills = payload.skills;
    return Array.isArray(skills) ? (skills as Array<{ manifest?: { id?: string; name?: string; metadata?: Record<string, unknown> } }>) : [];
}

describe('OpenClaw live integration (no mock)', () => {
    let sidecar: SidecarProcess | null = null;

    afterAll(() => {
        sidecar?.kill();
        sidecar = null;
    });

    test('ClawHub real install/uninstall + GitHub consistency + executable tool file', async () => {
        if (process.platform !== 'win32') {
            console.log('[SKIP] This live test currently targets a Windows skill/tool execution path.');
            return;
        }

        sidecar = new SidecarProcess();
        await sidecar.start();

        // Pre-clean possible leftovers from previous runs.
        await sendCommandAndWait(
            sidecar,
            'remove_claude_skill',
            { skillId: CLAWHUB_SKILL_SLUG, deleteFiles: true },
            'remove_claude_skill_response',
            30_000
        ).catch(() => undefined);

        await sendCommandAndWait(
            sidecar,
            'remove_claude_skill',
            { skillId: GITHUB_SKILL_ID, deleteFiles: true },
            'remove_claude_skill_response',
            30_000
        ).catch(() => undefined);

        const baselineReload = await sendCommandAndWait(
            sidecar,
            'reload_tools',
            {},
            'reload_tools_response',
            60_000
        );
        const baselineToolCount = Number(baselineReload.payload?.toolCount ?? 0);

        // 1) Real ClawHub search.
        const searchResponse = await sendCommandAndWait(
            sidecar,
            'search_openclaw_skill_store',
            { store: 'clawhub', query: 'windows ui automation', limit: 10 },
            'search_openclaw_skill_store_response'
        );
        expect(searchResponse.payload?.success).toBe(true);
        const searchSkills = Array.isArray(searchResponse.payload?.skills)
            ? (searchResponse.payload?.skills as Array<{ name?: string; slug?: string }>)
            : [];
        expect(searchSkills.length).toBeGreaterThan(0);
        const exact = searchSkills.find((skill) => (skill.name ?? skill.slug) === CLAWHUB_SKILL_SLUG);
        expect(Boolean(exact)).toBe(true);

        // 2) Install ClawHub skill.
        const installResponse = await sendCommandAndWait(
            sidecar,
            'install_openclaw_skill',
            { store: 'clawhub', skillName: CLAWHUB_SKILL_SLUG },
            'install_openclaw_skill_response',
            180_000
        );
        expect(installResponse.payload?.success).toBe(true);
        const installPath = String(installResponse.payload?.path ?? '');
        expect(installPath.length > 0).toBe(true);
        expect(fs.existsSync(path.join(installPath, 'SKILL.md'))).toBe(true);

        const mouseScriptPath = path.join(installPath, 'mouse_control.ps1.txt');
        const keyboardScriptPath = path.join(installPath, 'keyboard_control.ps1.txt');
        expect(fs.existsSync(mouseScriptPath)).toBe(true);
        expect(fs.existsSync(keyboardScriptPath)).toBe(true);

        const afterInstallReload = await sendCommandAndWait(
            sidecar,
            'reload_tools',
            {},
            'reload_tools_response',
            60_000
        );
        const afterInstallToolCount = Number(afterInstallReload.payload?.toolCount ?? 0);
        expect(afterInstallToolCount).toBeGreaterThanOrEqual(baselineToolCount + 1);

        // 3) Verify visible in CoworkAny list (same as desktop reads from sidecar list).
        const listAfterClawHubInstall = await sendCommandAndWait(
            sidecar,
            'list_claude_skills',
            { includeDisabled: true },
            'list_claude_skills_response'
        );
        const skillsAfterClawHubInstall = getSkillsFromListResponse(listAfterClawHubInstall);
        const clawHubSkill = skillsAfterClawHubInstall.find(
            (skill) => skill.manifest?.id === CLAWHUB_SKILL_SLUG || skill.manifest?.name === CLAWHUB_SKILL_SLUG
        );
        expect(Boolean(clawHubSkill)).toBe(true);

        // 4) Execute installed tool file using CoworkAny's real run_command tool implementation.
        const runCommandTool = STANDARD_TOOLS.find((tool) => tool.name === 'run_command');
        expect(Boolean(runCommandTool)).toBe(true);
        const runResult = await runCommandTool!.handler(
            {
                command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${mouseScriptPath}" -Action move -X 1 -Y 1`,
                cwd: process.cwd(),
                timeout_ms: 20_000,
            },
            {
                workspacePath: process.cwd(),
                taskId: randomUUID(),
            }
        ) as { exit_code?: number; error?: string; stderr?: string };
        expect(runResult.error ?? '').toBe('');
        expect(Number(runResult.exit_code ?? -1)).toBe(0);

        // 5) Uninstall ClawHub skill.
        const removeClawHubResponse = await sendCommandAndWait(
            sidecar,
            'remove_claude_skill',
            { skillId: CLAWHUB_SKILL_SLUG, deleteFiles: true },
            'remove_claude_skill_response'
        );
        expect(removeClawHubResponse.payload?.success).toBe(true);

        const listAfterClawHubRemove = await sendCommandAndWait(
            sidecar,
            'list_claude_skills',
            { includeDisabled: true },
            'list_claude_skills_response'
        );
        const skillsAfterClawHubRemove = getSkillsFromListResponse(listAfterClawHubRemove);
        const clawHubStillExists = skillsAfterClawHubRemove.some(
            (skill) => skill.manifest?.id === CLAWHUB_SKILL_SLUG || skill.manifest?.name === CLAWHUB_SKILL_SLUG
        );
        expect(clawHubStillExists).toBe(false);
        expect(fs.existsSync(installPath)).toBe(false);

        const afterRemoveReload = await sendCommandAndWait(
            sidecar,
            'reload_tools',
            {},
            'reload_tools_response',
            60_000
        );
        const afterRemoveToolCount = Number(afterRemoveReload.payload?.toolCount ?? 0);
        expect(afterRemoveToolCount).toBeLessThanOrEqual(afterInstallToolCount);

        // 6) GitHub install flow (consistency baseline).
        const installGithubResponse = await sendCommandAndWait(
            sidecar,
            'install_from_github',
            {
                workspacePath: process.cwd(),
                source: GITHUB_SKILL_SOURCE,
                targetType: 'skill',
            },
            'install_from_github_response',
            180_000
        );
        expect(installGithubResponse.payload?.success).toBe(true);

        const listAfterGithubInstall = await sendCommandAndWait(
            sidecar,
            'list_claude_skills',
            { includeDisabled: true },
            'list_claude_skills_response'
        );
        const skillsAfterGithubInstall = getSkillsFromListResponse(listAfterGithubInstall);
        const githubSkill = skillsAfterGithubInstall.find(
            (skill) => skill.manifest?.id === GITHUB_SKILL_ID || skill.manifest?.name === GITHUB_SKILL_ID
        );
        expect(Boolean(githubSkill)).toBe(true);

        const removeGithubResponse = await sendCommandAndWait(
            sidecar,
            'remove_claude_skill',
            { skillId: GITHUB_SKILL_ID, deleteFiles: true },
            'remove_claude_skill_response'
        );
        expect(removeGithubResponse.payload?.success).toBe(true);

        const listAfterGithubRemove = await sendCommandAndWait(
            sidecar,
            'list_claude_skills',
            { includeDisabled: true },
            'list_claude_skills_response'
        );
        const skillsAfterGithubRemove = getSkillsFromListResponse(listAfterGithubRemove);
        const githubStillExists = skillsAfterGithubRemove.some(
            (skill) => skill.manifest?.id === GITHUB_SKILL_ID || skill.manifest?.name === GITHUB_SKILL_ID
        );
        expect(githubStillExists).toBe(false);
    }, LIVE_TIMEOUT_MS);

    test('ClawHub command-style skill frontmatter is parsed and persisted', async () => {
        if (process.platform !== 'win32') {
            console.log('[SKIP] This live test currently targets a Windows environment.');
            return;
        }

        sidecar?.kill();
        sidecar = new SidecarProcess();
        await sidecar.start();

        await sendCommandAndWait(
            sidecar,
            'remove_claude_skill',
            { skillId: CLAWHUB_COMMAND_SKILL_SLUG, deleteFiles: true },
            'remove_claude_skill_response',
            30_000
        ).catch(() => undefined);

        const installResponse = await sendCommandAndWait(
            sidecar,
            'install_openclaw_skill',
            { store: 'clawhub', skillName: CLAWHUB_COMMAND_SKILL_SLUG },
            'install_openclaw_skill_response',
            180_000
        );
        expect(installResponse.payload?.success).toBe(true);

        const skillsJsonPath = path.join(process.cwd(), '.coworkany', 'skills.json');
        expect(fs.existsSync(skillsJsonPath)).toBe(true);
        const skillsJsonRaw = fs.readFileSync(skillsJsonPath, 'utf-8');
        const skillsJson = JSON.parse(skillsJsonRaw) as Record<string, { manifest?: Record<string, unknown> }>;
        const persisted = skillsJson[CLAWHUB_COMMAND_SKILL_SLUG];
        expect(Boolean(persisted?.manifest)).toBe(true);

        const manifest = (persisted?.manifest ?? {}) as Record<string, unknown>;
        const metadata = (manifest.metadata ?? {}) as Record<string, unknown>;
        const commands = metadata.commands;
        expect(Array.isArray(commands)).toBe(true);
        expect((commands as Array<unknown>).length).toBeGreaterThan(0);

        await sendCommandAndWait(
            sidecar,
            'remove_claude_skill',
            { skillId: CLAWHUB_COMMAND_SKILL_SLUG, deleteFiles: true },
            'remove_claude_skill_response',
            60_000
        );
    }, LIVE_TIMEOUT_MS);

});
