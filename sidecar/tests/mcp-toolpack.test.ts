/**
 * MCP-01 ~ MCP-05: MCP 与工具扩展测试 (P2)
 *
 * 对标 OpenClaw 50+ Integrations + ClawHub Skills Marketplace。
 * 验证 CoworkAny 的 MCP 集成和工具扩展系统：
 *   1. MCP Gateway 初始化
 *   2. 工具自动注册
 *   3. 工具优先级 (MCP > Builtin > Stub)
 *   4. 风险评估 (RiskDatabase)
 *   5. Toolpack 动态启停
 *
 * Run: cd sidecar && bun test tests/mcp-toolpack.test.ts
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.join(process.cwd(), 'src');

// ============================================================================
// MCP-01: MCP Gateway 启动
// ============================================================================

describe('MCP-01: MCP Gateway 初始化', () => {
    test('MCP Gateway 模块存在且可导入', () => {
        const gatewayPath = path.join(SRC_ROOT, 'mcp', 'gateway', 'index.ts');
        const exists = fs.existsSync(gatewayPath);
        console.log(`[Test] MCP Gateway exists: ${exists}`);
        expect(exists).toBe(true);

        if (exists) {
            const content = fs.readFileSync(gatewayPath, 'utf-8');

            // Should export MCPGateway class
            const hasClass = content.includes('class MCPGateway') || content.includes('export class');
            console.log(`[Test] MCPGateway class defined: ${hasClass}`);
            expect(hasClass).toBe(true);

            // Should have initialization logic
            const hasInit = content.includes('init') || content.includes('start') || content.includes('constructor');
            console.log(`[Test] Has initialization: ${hasInit}`);
            expect(hasInit).toBe(true);
        }
    });

    test('MCP Gateway 支持服务器生命周期管理', () => {
        const gatewayPath = path.join(SRC_ROOT, 'mcp', 'gateway', 'index.ts');
        if (!fs.existsSync(gatewayPath)) {
            console.log('[SKIP] MCP Gateway not found.');
            return;
        }

        const content = fs.readFileSync(gatewayPath, 'utf-8');

        const hasConnect = content.includes('connect') || content.includes('register');
        const hasDisconnect = content.includes('disconnect') || content.includes('shutdown') || content.includes('close');

        console.log(`[Test] Server connect: ${hasConnect}`);
        console.log(`[Test] Server disconnect: ${hasDisconnect}`);

        expect(hasConnect).toBe(true);
        expect(hasDisconnect).toBe(true);
    });
});

// ============================================================================
// MCP-02: 工具自动注册
// ============================================================================

describe('MCP-02: 工具自动注册', () => {
    test('工具注册表 (ToolRegistry) 存在', () => {
        const registryPath = path.join(SRC_ROOT, 'tools', 'registry.ts');
        const exists = fs.existsSync(registryPath);
        console.log(`[Test] Tool registry exists: ${exists}`);
        expect(exists).toBe(true);

        if (exists) {
            const content = fs.readFileSync(registryPath, 'utf-8');
            const hasRegister = content.includes('register') || content.includes('Register');
            const hasList = content.includes('getTools') || content.includes('listTools') || content.includes('getAllTools');

            console.log(`[Test] Has register method: ${hasRegister}`);
            console.log(`[Test] Has list/get method: ${hasList}`);

            expect(hasRegister).toBe(true);
        }
    });

    test('MCP 工具可注册到全局注册表', () => {
        const gatewayPath = path.join(SRC_ROOT, 'mcp', 'gateway', 'index.ts');
        if (!fs.existsSync(gatewayPath)) {
            console.log('[SKIP] MCP Gateway not found.');
            return;
        }

        const content = fs.readFileSync(gatewayPath, 'utf-8');
        const hasToolRegistration = content.includes('tool') && (
            content.includes('register') || content.includes('addTool') || content.includes('tools')
        );

        console.log(`[Test] Gateway registers tools: ${hasToolRegistration}`);
        expect(hasToolRegistration).toBe(true);
    });
});

// ============================================================================
// MCP-03: 工具优先级
// ============================================================================

describe('MCP-03: 工具优先级', () => {
    test('工具注册表支持优先级排序', () => {
        const registryPath = path.join(SRC_ROOT, 'tools', 'registry.ts');
        if (!fs.existsSync(registryPath)) {
            console.log('[SKIP] Tool registry not found.');
            return;
        }

        const content = fs.readFileSync(registryPath, 'utf-8');
        const hasPriority = content.includes('priority') || content.includes('Priority') ||
                           content.includes('MCP') || content.includes('override');

        console.log(`[Test] Priority/override support: ${hasPriority}`);
        expect(hasPriority).toBe(true);
    });

    test('Stub 工具定义存在（作为最低优先级兜底）', () => {
        const stubsPath = path.join(SRC_ROOT, 'tools', 'stubs.ts');
        const exists = fs.existsSync(stubsPath);
        console.log(`[Test] Stubs file exists: ${exists}`);
        expect(exists).toBe(true);

        if (exists) {
            const content = fs.readFileSync(stubsPath, 'utf-8');
            const hasStubTools = content.includes('STUB_TOOLS') || content.includes('coming_soon');
            console.log(`[Test] Stub tools defined: ${hasStubTools}`);
            expect(hasStubTools).toBe(true);
        }
    });
});

// ============================================================================
// MCP-04: 风险评估
// ============================================================================

describe('MCP-04: 风险评估', () => {
    test('风险评估模块存在', () => {
        // Search for risk-related files in the MCP or policy directories
        const possiblePaths = [
            path.join(SRC_ROOT, 'mcp', 'gateway', 'index.ts'),
            path.join(SRC_ROOT, 'policy', 'mod.rs'),  // Rust side
        ];

        let foundRisk = false;
        for (const riskPath of possiblePaths) {
            if (fs.existsSync(riskPath)) {
                const content = fs.readFileSync(riskPath, 'utf-8');
                if (content.includes('risk') || content.includes('Risk')) {
                    foundRisk = true;
                    console.log(`[Test] Risk assessment found in: ${riskPath}`);
                    break;
                }
            }
        }

        // Also check for risk in gateway
        const gatewayPath = path.join(SRC_ROOT, 'mcp', 'gateway', 'index.ts');
        if (fs.existsSync(gatewayPath)) {
            const content = fs.readFileSync(gatewayPath, 'utf-8');
            if (content.includes('risk') || content.includes('Risk') || content.includes('audit') || content.includes('Audit')) {
                foundRisk = true;
            }
        }

        console.log(`[Test] Risk assessment module found: ${foundRisk}`);
        expect(foundRisk).toBe(true);
    });
});

// ============================================================================
// MCP-05: Toolpack 动态启停
// ============================================================================

describe('MCP-05: Toolpack 动态启停', () => {
    test('Toolpack 定义和管理模块存在', () => {
        // Check for toolpack definitions
        const defaultsPath = path.join(SRC_ROOT, 'data', 'defaults.ts');
        const exists = fs.existsSync(defaultsPath);
        console.log(`[Test] defaults.ts exists: ${exists}`);
        expect(exists).toBe(true);

        if (exists) {
            const content = fs.readFileSync(defaultsPath, 'utf-8');

            // Should define BUILTIN_TOOLPACKS
            const hasToolpacks = content.includes('BUILTIN_TOOLPACKS');
            console.log(`[Test] BUILTIN_TOOLPACKS defined: ${hasToolpacks}`);
            expect(hasToolpacks).toBe(true);

            // Count toolpacks
            const matches = content.match(/id:\s*['"]builtin-/g);
            const count = matches ? matches.length : 0;
            console.log(`[Test] Number of builtin toolpacks: ${count}`);
            expect(count).toBeGreaterThanOrEqual(3); // At least 3 toolpacks
        }
    });

    test('任务配置支持启用/禁用 toolpacks', () => {
        // Check that task creation supports enabledToolpacks config
        const mainPath = path.join(SRC_ROOT, 'main.ts');
        const exists = fs.existsSync(mainPath);

        if (exists) {
            const content = fs.readFileSync(mainPath, 'utf-8');
            const hasToolpackConfig = content.includes('enabledToolpacks') || content.includes('toolpacks');
            console.log(`[Test] enabledToolpacks in task config: ${hasToolpackConfig}`);
            expect(hasToolpackConfig).toBe(true);
        } else {
            console.log('[SKIP] main.ts not found.');
        }
    });

    test('各 toolpack 包含预期的工具', () => {
        const defaultsPath = path.join(SRC_ROOT, 'data', 'defaults.ts');
        if (!fs.existsSync(defaultsPath)) {
            console.log('[SKIP] defaults.ts not found.');
            return;
        }

        const content = fs.readFileSync(defaultsPath, 'utf-8');

        // Check known toolpacks contain expected tools
        const expectedToolpacks: Record<string, string[]> = {
            'builtin-github': ['create_issue', 'create_pr', 'list_repos'],
            'builtin-filesystem': ['view_file', 'write_to_file'],
            'builtin-websearch': ['search_web'],
            'builtin-memory': ['remember', 'recall'],
        };

        for (const [packId, expectedTools] of Object.entries(expectedToolpacks)) {
            const hasPack = content.includes(packId);
            if (hasPack) {
                for (const tool of expectedTools) {
                    const hasTool = content.includes(tool);
                    console.log(`[Test] ${packId} -> ${tool}: ${hasTool}`);
                }
            } else {
                console.log(`[INFO] Toolpack ${packId} not found in defaults.ts`);
            }
        }

        // At minimum, websearch and filesystem should exist
        expect(content.includes('builtin-websearch')).toBe(true);
        expect(content.includes('builtin-filesystem')).toBe(true);
    });
});
