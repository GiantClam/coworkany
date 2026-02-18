
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class VisualService {
    private tempDir: string;

    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'coworkany-visual');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async captureScreenshot(): Promise<string> {
        const outputPath = path.join(this.tempDir, `screenshot-${Date.now()}.png`);

        // PowerShell script to capture screen
        const psScript = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen
            $bitmap = New-Object System.Drawing.Bitmap $screen.Bounds.Width, $screen.Bounds.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $bitmap.Size)
            $bitmap.Save('${outputPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
            $graphics.Dispose()
            $bitmap.Dispose()
        `;

        await new Promise<void>((resolve, reject) => {
            const child = spawn('powershell', ['-command', psScript], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error('Screenshot failed'));
            });

            child.on('error', reject);
        });

        if (!fs.existsSync(outputPath)) {
            throw new Error('Screenshot file not created');
        }

        const buffer = fs.readFileSync(outputPath);
        // Clean up
        fs.unlinkSync(outputPath);

        return buffer.toString('base64');
    }

    async analyzeScreen(query: string, llmClient: any): Promise<string> {
        const base64Image = await this.captureScreenshot();

        // Check if LLM supports vision (rough check)
        // This assumes the llmClient interface supports images
        // In a real implementation, we'd need to adapt the message format

        const message = {
            role: 'user',
            content: [
                { type: 'text', text: `Please look at this screenshot and answer: ${query}` },
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: base64Image
                    }
                }
            ]
        };

        // Mock call for now if client structure isn't known
        // return llmClient.chat([message]);

        return "Visual analysis placeholder - requires LLM integration";
    }
}
