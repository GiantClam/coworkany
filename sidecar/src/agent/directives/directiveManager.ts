
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Directive {
    id: string;
    name: string;
    content: string;
    enabled: boolean;
    priority: number; // Higher is more important
    trigger?: string; // Optional regex trigger
}

export interface Persona {
    id: string;
    name: string;
    description: string;
    directives: string[]; // IDs of directives enabled for this persona
}

export class DirectiveManager {
    private directives: Map<string, Directive> = new Map();
    private personas: Map<string, Persona> = new Map();
    private activePersonaId: string | null = null;
    private configPath: string;

    constructor(workspacePath?: string) {
        const root = workspacePath || path.join(os.homedir(), '.coworkany');
        if (!fs.existsSync(root)) {
            fs.mkdirSync(root, { recursive: true });
        }
        this.configPath = path.join(root, 'directives.json');
        this.load();
    }

    private load() {
        if (fs.existsSync(this.configPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));

                this.directives.clear();
                (data.directives || []).forEach((d: Directive) => this.directives.set(d.id, d));

                this.personas.clear();
                (data.personas || []).forEach((p: Persona) => this.personas.set(p.id, p));

                this.activePersonaId = data.activePersonaId || null;
            } catch (e) {
                console.error('Failed to load directives:', e);
            }
        } else {
            // Defaults
            this.addDirective({
                id: 'no-any',
                name: 'No Any',
                content: 'Do NOT use the `any` type in TypeScript. Use `unknown` or define a specific interface.',
                enabled: true,
                priority: 1
            });
            this.addDirective({
                id: 'concise',
                name: 'Concise Responses',
                content: 'Keep responses brief and to the point. Minimal explanation unless asked.',
                enabled: false,
                priority: 0
            });
            this.save();
        }
    }

    private save() {
        const data = {
            directives: Array.from(this.directives.values()),
            personas: Array.from(this.personas.values()),
            activePersonaId: this.activePersonaId
        };
        fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
    }

    addDirective(directive: Directive) {
        this.directives.set(directive.id, directive);
        this.save();
    }

    getSystemPromptAdditions(query: string): string {
        let activeDirectives: Directive[] = [];

        if (this.activePersonaId && this.personas.has(this.activePersonaId)) {
            const persona = this.personas.get(this.activePersonaId)!;
            activeDirectives = persona.directives
                .map(id => this.directives.get(id))
                .filter((d): d is Directive => !!d && d.enabled);
        } else {
            // No persona, use all enabled global directives
            activeDirectives = Array.from(this.directives.values()).filter(d => d.enabled);
        }

        // Filter by trigger if present
        activeDirectives = activeDirectives.filter(d => {
            if (!d.trigger) return true;
            try {
                return new RegExp(d.trigger, 'i').test(query);
            } catch {
                return false;
            }
        });

        // Sort by priority
        activeDirectives.sort((a, b) => b.priority - a.priority);

        if (activeDirectives.length === 0) return '';

        return `\n\n## User Directives (Identity & Rules)\n` +
            `You must strictly follow these rules:\n\n` +
            activeDirectives.map(d => `- [${d.name}] ${d.content}`).join('\n');
    }
}
