/**
 * Core System Skill
 * 
 * Provides system status, OS/platform information, and Daemon health checks.
 * Drives the "Pulse" aspect of the architecture.
 */

import * as os from 'os';
import { ToolDefinition, ToolContext } from '../standard';
import { getDaemonService } from '../../agent/jarvis/daemonService';

const daemonService = getDaemonService();

function getPlatformName(): string {
    switch (os.platform()) {
        case 'win32': return 'windows';
        case 'darwin': return 'macos';
        default: return 'linux';
    }
}

export const systemStatusTool: ToolDefinition = {
    name: 'system_status',
    description: 'Check system status including OS/platform info, hardware specs, and agent health. Use this to understand the current system environment before executing platform-specific commands.',
    effects: ['state:remember'], // Reading system state
    input_schema: {
        type: 'object',
        properties: {},
    },
    handler: async (_args: any, _context: ToolContext) => {
        try {
            const isHealthy = daemonService.isHealthy();
            const stats = daemonService.getStats();

            return {
                success: true,
                status: 'operational',
                healthy: isHealthy,
                // OS & Platform info
                platform: os.platform(),
                platformName: getPlatformName(),
                osType: os.type(),
                osRelease: os.release(),
                arch: os.arch(),
                hostname: os.hostname(),
                // Hardware info
                totalMemoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10,
                freeMemoryGB: Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10,
                cpuCores: os.cpus().length,
                cpuModel: os.cpus()[0]?.model || 'unknown',
                // Uptime
                uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10,
                // Agent stats
                stats: stats,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
};
