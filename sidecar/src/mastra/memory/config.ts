import { mkdirSync } from 'fs';
import path from 'path';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { fastembed } from '@mastra/fastembed';
import { Memory } from '@mastra/memory';
import { workingMemoryTemplate } from './working-memory-template';
const DEFAULT_DB_PATH = path.resolve(process.cwd(), '.coworkany', 'data', 'coworkany.db');
const DEFAULT_DB_DIR = path.dirname(DEFAULT_DB_PATH);
const OBSERVATIONAL_MEMORY_ENABLED = process.env.COWORKANY_ENABLE_OBSERVATIONAL_MEMORY !== '0';
mkdirSync(DEFAULT_DB_DIR, { recursive: true });
export const COWORKANY_DB_URL = process.env.COWORKANY_DB_URL || `file:${DEFAULT_DB_PATH}`;
export const memoryStorage = new LibSQLStore({
    id: 'coworkany-storage',
    url: COWORKANY_DB_URL,
});
export const memoryVector = new LibSQLVector({
    id: 'coworkany-vector',
    url: COWORKANY_DB_URL,
});
export const memoryConfig = new Memory({
    storage: memoryStorage,
    vector: memoryVector,
    embedder: fastembed,
    options: {
        lastMessages: 20,
        semanticRecall: {
            topK: 5,
            messageRange: { before: 3, after: 1 },
            scope: 'resource',
        },
        workingMemory: {
            enabled: true,
            template: workingMemoryTemplate,
            scope: 'resource',
        },
        observationalMemory: OBSERVATIONAL_MEMORY_ENABLED,
        generateTitle: true,
    },
});
