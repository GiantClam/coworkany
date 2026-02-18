import { promises as fs } from 'fs';
import path from 'path';
import { SkillContextBundle, SkillRecord } from './types';

const DEFAULT_INSTRUCTION_FILES = ['SKILL.md', 'README.md', 'instructions.md'];

export async function loadSkillContext(record: SkillRecord): Promise<SkillContextBundle> {
    const instructions = await loadInstructions(record.rootPath);
    const resources = await loadResourceFiles(record.rootPath);

    return {
        skillId: record.manifest.id,
        instructions,
        resources,
    };
}

async function loadInstructions(rootPath: string): Promise<string> {
    for (const file of DEFAULT_INSTRUCTION_FILES) {
        const candidate = path.join(rootPath, file);
        try {
            const content = await fs.readFile(candidate, 'utf-8');
            return content;
        } catch {
            continue;
        }
    }
    return '';
}

async function loadResourceFiles(rootPath: string): Promise<Array<{ path: string; content: string }>> {
    const resourcesDir = path.join(rootPath, 'resources');
    try {
        const entries = await fs.readdir(resourcesDir, { withFileTypes: true });
        const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
        const results: Array<{ path: string; content: string }> = [];
        for (const file of files) {
            const fullPath = path.join(resourcesDir, file);
            const content = await fs.readFile(fullPath, 'utf-8');
            results.push({ path: fullPath, content });
        }
        return results;
    } catch {
        return [];
    }
}
