/**
 * CoworkAny - Database Tools
 *
 * Provides database operation capabilities including:
 * - SQL execution (MySQL, PostgreSQL, SQLite)
 * - NoSQL operations (MongoDB)
 * - Database connection management
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ToolDefinition, ToolContext } from './standard';

const execAsync = promisify(exec);

export type DatabaseType = 'mysql' | 'postgres' | 'sqlite' | 'mongodb';

export interface DatabaseConnectionConfig {
    type: DatabaseType;
    host?: string;
    port?: number;
    database: string;
    user?: string;
    password?: string;
    connectionString?: string;
    readOnly?: boolean;
}

export interface QueryResult {
    success: boolean;
    rows?: any[];
    affectedRows?: number;
    error?: string;
    executionTime?: number;
}

const activeConnections: Map<string, DatabaseConnectionConfig> = new Map();

const DEFAULT_ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function getHostAllowlist(): Set<string> {
    const configured = process.env.COWORKANY_DB_HOST_ALLOWLIST;
    if (!configured) {
        return new Set(DEFAULT_ALLOWED_HOSTS);
    }

    const parsed = configured
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

    return new Set(parsed.length > 0 ? parsed : Array.from(DEFAULT_ALLOWED_HOSTS));
}

function extractHostFromConnectionString(connectionString?: string): string | undefined {
    if (!connectionString) return undefined;
    try {
        const parsed = new URL(connectionString);
        return parsed.hostname.toLowerCase();
    } catch {
        return undefined;
    }
}

function sanitizeSecrets(value: string): string {
    return value
        .replace(/(password\s*[=:]\s*)([^\s;]+)/gi, '$1***')
        .replace(/(mongodb(?:\+srv)?:\/\/[^\s:@]+:)([^@\s]+)(@)/gi, '$1***$3')
        .replace(/(-p)([^\s]+)/g, '$1***');
}

function isWriteStatement(statement: string): boolean {
    const normalized = statement.trim().replace(/^\(+/, '').toUpperCase();
    return /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|MERGE|GRANT|REVOKE)\b/.test(normalized);
}

function validateHostPolicy(config: DatabaseConnectionConfig): { ok: true } | { ok: false; error: string } {
    if (config.type === 'sqlite') {
        return { ok: true };
    }

    const allowlist = getHostAllowlist();
    const host = (config.host || extractHostFromConnectionString(config.connectionString) || '').toLowerCase();
    if (!host) {
        return { ok: false, error: 'Database host is required for non-SQLite connections.' };
    }

    if (!allowlist.has(host)) {
        return {
            ok: false,
            error: `Host "${host}" is not in allowlist. Configure COWORKANY_DB_HOST_ALLOWLIST to allow additional hosts.`,
        };
    }

    return { ok: true };
}

function getConnectionId(config: DatabaseConnectionConfig): string {
    return `${config.type}-${config.host || 'local'}-${config.database}`;
}

async function runDbCommand(
    config: DatabaseConnectionConfig,
    query: string,
    timeout: number = 30000
): Promise<QueryResult> {
    const startTime = Date.now();

    try {
        let command: string;

        switch (config.type) {
            case 'mysql':
                command = `mysql -h ${config.host || 'localhost'} -P ${config.port || 3306} -u ${config.user || 'root'} ${config.password ? `-p${config.password}` : ''} ${config.database} -e "${query.replace(/"/g, '\\"')}"`;
                break;

            case 'postgres':
                command = `psql -h ${config.host || 'localhost'} -p ${config.port || 5432} -U ${config.user || 'postgres'} -d ${config.database} -c "${query.replace(/"/g, '\\"')}"`;
                break;

            case 'sqlite': {
                const dbPath = path.resolve(config.database);
                command = `sqlite3 "${dbPath}" "${query.replace(/"/g, '\\"')}"`;
                break;
            }

            case 'mongodb': {
                const mongoUri = config.connectionString || `mongodb://${config.host || 'localhost'}:${config.port || 27017}/${config.database}`;
                command = `mongosh "${mongoUri}" --quiet --eval "${query.replace(/"/g, '\\"')}"`;
                break;
            }

            default:
                return { success: false, error: `Unsupported database type: ${config.type}` };
        }

        const { stdout, stderr } = await execAsync(command, { timeout });
        const executionTime = Date.now() - startTime;

        if (stderr && !stderr.includes('Warning')) {
            return { success: false, error: sanitizeSecrets(stderr), executionTime };
        }

        const rows = stdout.trim()
            ? stdout.trim().split('\n').map((line) => {
                  try {
                      return line.includes('\t')
                          ? line.split('\t').reduce((acc, val, idx) => {
                                acc[`col${idx}`] = val;
                                return acc;
                            }, {} as any)
                          : JSON.parse(line);
                  } catch {
                      return { result: line };
                  }
              })
            : [];

        return { success: true, rows, executionTime };
    } catch (error: any) {
        const executionTime = Date.now() - startTime;
        return {
            success: false,
            error: sanitizeSecrets(error.message || String(error)),
            executionTime,
        };
    }
}

export const databaseConnectTool: ToolDefinition = {
    name: 'database_connect',
    description: 'Connect to a database and store the connection for later use. Supports MySQL, PostgreSQL, SQLite, and MongoDB.',
    effects: ['network:outbound', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                enum: ['mysql', 'postgres', 'sqlite', 'mongodb'],
                description: 'Database type',
            },
            host: {
                type: 'string',
                description: 'Database host (not needed for SQLite)',
            },
            port: {
                type: 'number',
                description: 'Database port (default varies by type)',
            },
            database: {
                type: 'string',
                description: 'Database name or file path (for SQLite)',
            },
            user: {
                type: 'string',
                description: 'Database user (not needed for SQLite)',
            },
            password: {
                type: 'string',
                description: 'Database password (not needed for SQLite)',
            },
            connectionString: {
                type: 'string',
                description: 'Full connection string (for MongoDB or custom)',
            },
            readOnly: {
                type: 'boolean',
                default: true,
                description: 'Whether to enforce read-only mode for this connection. Defaults to true for safety.',
            },
            alias: {
                type: 'string',
                description: 'Friendly name for this connection',
            },
        },
        required: ['type', 'database'],
    },
    handler: async (args: any, _context: ToolContext) => {
        const config: DatabaseConnectionConfig = {
            type: args.type,
            host: args.host,
            port: args.port,
            database: args.database,
            user: args.user,
            password: args.password,
            connectionString: args.connectionString,
            readOnly: args.readOnly !== false,
        };

        const connectionId = args.alias || getConnectionId(config);

        const hostPolicy = validateHostPolicy(config);
        if (!hostPolicy.ok) {
            return {
                success: false,
                error: hostPolicy.error,
            };
        }

        try {
            const testQuery = config.type === 'sqlite' ? 'SELECT 1' : 'SELECT 1 as test';
            const result = await runDbCommand(config, testQuery, 5000);

            if (result.success) {
                activeConnections.set(connectionId, config);
                return {
                    success: true,
                    message: `Connected to ${config.type} database: ${config.database}`,
                    connectionId,
                    readOnly: config.readOnly !== false,
                };
            }

            return {
                success: false,
                error: `Connection failed: ${sanitizeSecrets(result.error || 'unknown error')}`,
            };
        } catch (error: any) {
            return {
                success: false,
                error: sanitizeSecrets(error.message || String(error)),
            };
        }
    },
};

export const databaseQueryTool: ToolDefinition = {
    name: 'database_query',
    description: 'Execute a SQL or NoSQL query on a connected database. Use for SELECT, SHOW, and other read operations.',
    effects: ['network:outbound', 'knowledge:read'],
    input_schema: {
        type: 'object',
        properties: {
            connection: {
                type: 'string',
                description: 'Connection alias or ID from database_connect',
            },
            query: {
                type: 'string',
                description: 'SQL query to execute',
            },
            timeout: {
                type: 'number',
                default: 30000,
                description: 'Query timeout in milliseconds',
            },
        },
        required: ['connection', 'query'],
    },
    handler: async (args: any, _context: ToolContext) => {
        const config = activeConnections.get(args.connection);

        if (!config) {
            return {
                success: false,
                error: `No active connection found: ${args.connection}. Use database_connect first.`,
            };
        }

        if (isWriteStatement(String(args.query || ''))) {
            return {
                success: false,
                error: 'database_query only allows read statements. Use database_execute for writes.',
            };
        }

        return runDbCommand(config, args.query, args.timeout || 30000);
    },
};

export const databaseExecuteTool: ToolDefinition = {
    name: 'database_execute',
    description: 'Execute a SQL statement that modifies data (INSERT, UPDATE, DELETE, CREATE, ALTER). Use for write operations.',
    effects: ['network:outbound', 'knowledge:update'],
    input_schema: {
        type: 'object',
        properties: {
            connection: {
                type: 'string',
                description: 'Connection alias or ID from database_connect',
            },
            statement: {
                type: 'string',
                description: 'SQL statement to execute',
            },
            timeout: {
                type: 'number',
                default: 30000,
                description: 'Statement timeout in milliseconds',
            },
        },
        required: ['connection', 'statement'],
    },
    handler: async (args: any, _context: ToolContext) => {
        const config = activeConnections.get(args.connection);

        if (!config) {
            return {
                success: false,
                error: `No active connection found: ${args.connection}. Use database_connect first.`,
            };
        }

        if (config.readOnly !== false) {
            return {
                success: false,
                error: 'Connection is in read-only mode. Reconnect with readOnly=false to run write statements.',
            };
        }

        return runDbCommand(config, args.statement, args.timeout || 30000);
    },
};

export const databaseDisconnectTool: ToolDefinition = {
    name: 'database_disconnect',
    description: 'Close an active database connection.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            connection: {
                type: 'string',
                description: 'Connection alias or ID to close',
            },
        },
        required: ['connection'],
    },
    handler: async (args: any, _context: ToolContext) => {
        const existed = activeConnections.has(args.connection);
        activeConnections.delete(args.connection);

        return {
            success: true,
            message: existed
                ? `Disconnected: ${args.connection}`
                : `Connection not found: ${args.connection}`,
        };
    },
};

export const databaseListConnectionsTool: ToolDefinition = {
    name: 'database_list_connections',
    description: 'List all active database connections.',
    effects: [],
    input_schema: {
        type: 'object',
        properties: {},
    },
    handler: async (_args: any, _context: ToolContext) => {
        const connections = Array.from(activeConnections.entries()).map(([id, config]) => ({
            id,
            type: config.type,
            database: config.database,
            host: config.host || 'local',
            readOnly: config.readOnly !== false,
            user: config.user ? '***' : undefined,
            connectionString: config.connectionString ? sanitizeSecrets(config.connectionString) : undefined,
        }));

        return {
            success: true,
            connections,
        };
    },
};

export const DATABASE_TOOLS = [
    databaseConnectTool,
    databaseQueryTool,
    databaseExecuteTool,
    databaseDisconnectTool,
    databaseListConnectionsTool,
];
