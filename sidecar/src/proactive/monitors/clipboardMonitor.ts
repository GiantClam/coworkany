
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export class ClipboardMonitor extends EventEmitter {
    private lastContent: string = '';
    private intervalId: NodeJS.Timeout | null = null;
    private checkIntervalMs: number = 1000;

    constructor(intervalMs: number = 1000) {
        super();
        this.checkIntervalMs = intervalMs;
    }

    start() {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => this.checkClipboard(), this.checkIntervalMs);
        console.log('[ClipboardMonitor] Started');
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log('[ClipboardMonitor] Stopped');
    }

    private async checkClipboard() {
        try {
            const content = await this.getClipboardContent();
            if (content && content !== this.lastContent) {
                this.lastContent = content;
                this.emit('change', content);

                // Heuristic: Check if looks like error
                if (this.isErrorStack(content)) {
                    this.emit('error_stack', content);
                }
            }
        } catch (error) {
            // Ignore clipboard errors (locked, etc)
        }
    }

    private isErrorStack(text: string): boolean {
        // Simple heuristics
        if (text.length > 5000) return false; // Too long
        if (text.length < 20) return false;   // Too short

        return (
            text.includes('Error:') ||
            text.includes('Exception:') ||
            text.includes('Stack trace:') ||
            (text.includes('at ') && text.includes('(') && text.includes(')')) // JS stack trace line
        );
    }

    private getClipboardContent(): Promise<string> {
        return new Promise((resolve, reject) => {
            // Windows PowerShell
            const child = spawn('powershell', ['-command', 'Get-Clipboard'], {
                stdio: ['ignore', 'pipe', 'ignore']
            });

            let stdout = '';
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    resolve(''); // Fail silently
                }
            });

            child.on('error', () => resolve(''));
        });
    }
}
