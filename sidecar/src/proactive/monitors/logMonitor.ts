
import * as fs from 'fs';
import { EventEmitter } from 'events';

export class LogMonitor extends EventEmitter {
    private filePath: string;
    private currentSize: number = 0;
    private watcher: fs.FSWatcher | null = null;
    private checkInterval: NodeJS.Timeout | null = null;

    constructor(filePath: string) {
        super();
        this.filePath = filePath;
    }

    start() {
        if (!fs.existsSync(this.filePath)) {
            console.warn(`[LogMonitor] File not found: ${this.filePath}`);
            return;
        }

        const stat = fs.statSync(this.filePath);
        this.currentSize = stat.size;

        // Watch for changes
        try {
            this.watcher = fs.watch(this.filePath, (eventType) => {
                if (eventType === 'change') {
                    this.readNewContent();
                }
            });

            // Backup polling
            this.checkInterval = setInterval(() => this.checkSize(), 2000);

            console.log(`[LogMonitor] Started watching ${this.filePath}`);
        } catch (e) {
            console.error(`[LogMonitor] Failed to watch ${this.filePath}:`, e);
        }
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private checkSize() {
        if (!fs.existsSync(this.filePath)) return;
        const stat = fs.statSync(this.filePath);
        if (stat.size !== this.currentSize) {
            this.readNewContent();
        }
    }

    private readNewContent() {
        if (!fs.existsSync(this.filePath)) return;

        const stat = fs.statSync(this.filePath);
        if (stat.size < this.currentSize) {
            // File truncated
            this.currentSize = stat.size;
            return;
        }

        if (stat.size === this.currentSize) return;

        const stream = fs.createReadStream(this.filePath, {
            start: this.currentSize,
            end: stat.size,
            encoding: 'utf-8'
        });

        let data = '';
        stream.on('data', (chunk) => {
            data += chunk;
        });

        stream.on('end', () => {
            this.currentSize = stat.size;
            if (data) {
                this.emit('logs', data);

                // Check for errors
                if (data.toLowerCase().includes('error') || data.toLowerCase().includes('exception')) {
                    this.emit('error_log', data);
                }
            }
        });
    }
}
