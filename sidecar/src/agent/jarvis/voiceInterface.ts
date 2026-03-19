/**
 * CoworkAny - Voice Interface (语音接口)
 *
 * 优先使用本机语音能力：
 * - Windows: Speech API
 * - macOS: Speech Synthesis Framework
 * - Linux: espeak/festival
 *
 * 如果本机不可用，通过插件扩展：
 * - OpenAI Whisper API (ASR)
 * - OpenAI TTS / ElevenLabs (TTS)
 */

import { exec, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const MACOS_PREFERRED_CJK_VOICES = ['Tingting', 'Sinji', 'Meijia'];

function containsCjk(text: string): boolean {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/u.test(text);
}

export function normalizeMacOSTextForSpeech(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        // Default macOS voices can prematurely stop on mixed CJK + English contractions.
        .replace(/([A-Za-z])[’']([A-Za-z])/g, '$1$2');
}

// ============================================================================
// Types
// ============================================================================

export interface VoiceConfig {
    enabled: boolean;

    // ASR (Automatic Speech Recognition)
    asr: {
        provider: 'native' | 'whisper' | 'plugin';
        language: string;
        continuous: boolean;
    };

    // TTS (Text-to-Speech)
    tts: {
        provider: 'native' | 'openai' | 'elevenlabs' | 'plugin';
        voice: string;
        rate: number;  // 0.5 - 2.0
        volume: number;  // 0.0 - 1.0
    };

    // Wake word detection
    wakeWord?: {
        enabled: boolean;
        words: string[];  // ['Hey Jarvis', 'Jarvis']
        sensitivity: number;  // 0.0 - 1.0
    };
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
    enabled: false,  // 需要用户明确启用

    asr: {
        provider: 'native',
        language: 'en-US',
        continuous: false,
    },

    tts: {
        provider: 'native',
        voice: 'default',
        rate: 1.0,
        volume: 0.8,
    },

    wakeWord: {
        enabled: false,
        words: ['Hey Jarvis', 'Jarvis'],
        sensitivity: 0.7,
    },
};

export interface SpeechRecognitionResult {
    text: string;
    confidence: number;
    isFinal: boolean;
    language?: string;
    alternatives?: Array<{ text: string; confidence: number }>;
}

export interface VoicePlaybackState {
    isSpeaking: boolean;
    canStop: boolean;
    previewText?: string;
    fullTextLength?: number;
    taskId?: string;
    source?: string;
    startedAt?: string;
    endedAt?: string;
    reason?: string;
    error?: string;
}

type VoicePlaybackMetadata = {
    taskId?: string;
    source?: string;
};

// ============================================================================
// VoiceInterface Class
// ============================================================================

export class VoiceInterface {
    private config: VoiceConfig;
    private platform: 'windows' | 'darwin' | 'linux' | 'unknown';
    private nativeASRAvailable: boolean;
    private nativeTTSAvailable: boolean;
    private currentPlayback: { id: number; child: ChildProcess; cleanup?: () => void } | null;
    private playbackState: VoicePlaybackState;
    private playbackListeners: Set<(state: VoicePlaybackState) => void>;
    private playbackSequence: number;
    private finalizedPlaybackIds: Set<number>;
    private stopReasons: Map<number, string>;

    constructor(config?: Partial<VoiceConfig>) {
        this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
        this.platform = this.detectPlatform();
        this.nativeASRAvailable = false;
        this.nativeTTSAvailable = false;
        this.currentPlayback = null;
        this.playbackState = {
            isSpeaking: false,
            canStop: false,
        };
        this.playbackListeners = new Set();
        this.playbackSequence = 0;
        this.finalizedPlaybackIds = new Set();
        this.stopReasons = new Map();
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * 初始化语音接口
     */
    async initialize(): Promise<void> {
        console.log('[Voice] Initializing...');

        // 检测本机语音能力
        this.nativeASRAvailable = await this.checkNativeASR();
        this.nativeTTSAvailable = await this.checkNativeTTS();

        console.log(`[Voice] Platform: ${this.platform}`);
        console.log(`[Voice] Native ASR: ${this.nativeASRAvailable ? 'Available' : 'Not available'}`);
        console.log(`[Voice] Native TTS: ${this.nativeTTSAvailable ? 'Available' : 'Not available'}`);

        // 自动选择可用的 provider
        if (this.config.asr.provider === 'native' && !this.nativeASRAvailable) {
            console.log('[Voice] Native ASR not available, fallback to plugin mode');
            this.config.asr.provider = 'plugin';
        }

        if (this.config.tts.provider === 'native' && !this.nativeTTSAvailable) {
            console.log('[Voice] Native TTS not available, fallback to plugin mode');
            this.config.tts.provider = 'plugin';
        }
    }

    /**
     * 检测操作系统
     */
    private detectPlatform(): 'windows' | 'darwin' | 'linux' | 'unknown' {
        const platform = os.platform();
        if (platform === 'win32') return 'windows';
        if (platform === 'darwin') return 'darwin';
        if (platform === 'linux') return 'linux';
        return 'unknown';
    }

    /**
     * 检查本机 ASR 是否可用
     */
    private async checkNativeASR(): Promise<boolean> {
        try {
            switch (this.platform) {
                case 'windows':
                    // Windows Speech Recognition
                    // 检查是否安装了 Windows Speech Recognition
                    return true;  // Windows 10+ 通常自带

                case 'darwin':
                    // macOS Dictation
                    return true;  // macOS 通常自带

                case 'linux':
                    // 检查 espeak 或 festival
                    try {
                        await execAsync('which espeak');
                        return true;
                    } catch {
                        return false;
                    }

                default:
                    return false;
            }
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查本机 TTS 是否可用
     */
    private async checkNativeTTS(): Promise<boolean> {
        try {
            switch (this.platform) {
                case 'windows':
                    // Windows SAPI (Speech API)
                    return true;  // Windows 通常自带

                case 'darwin':
                    // macOS 'say' command
                    try {
                        await execAsync('which say');
                        return true;
                    } catch {
                        return false;
                    }

                case 'linux':
                    // espeak-ng or festival
                    try {
                        await execAsync('which espeak-ng || which espeak || which festival');
                        return true;
                    } catch {
                        return false;
                    }

                default:
                    return false;
            }
        } catch (error) {
            return false;
        }
    }

    // ========================================================================
    // Speech Recognition (ASR)
    // ========================================================================

    /**
     * 开始语音识别
     */
    async startListening(): Promise<SpeechRecognitionResult> {
        if (!this.config.enabled) {
            throw new Error('Voice interface is disabled');
        }

        console.log('[Voice] Starting speech recognition...');

        switch (this.config.asr.provider) {
            case 'native':
                return this.nativeASR();

            case 'whisper':
                return this.whisperASR();

            case 'plugin':
                return this.pluginASR();

            default:
                throw new Error(`Unknown ASR provider: ${this.config.asr.provider}`);
        }
    }

    /**
     * 本机 ASR
     */
    private async nativeASR(): Promise<SpeechRecognitionResult> {
        console.log('[Voice] Using native ASR');

        switch (this.platform) {
            case 'windows':
                return this.windowsASR();

            case 'darwin':
                return this.macOSASR();

            case 'linux':
                return this.linuxASR();

            default:
                throw new Error('Native ASR not supported on this platform');
        }
    }

    /**
     * Windows Speech Recognition
     */
    private async windowsASR(): Promise<SpeechRecognitionResult> {
        // 使用 PowerShell 调用 Windows Speech Recognition
        const script = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$recognizer.SetInputToDefaultAudioDevice()
$result = $recognizer.Recognize()
$result.Text
        `;

        try {
            const { stdout } = await execAsync(`powershell -Command "${script.replace(/\n/g, '; ')}"`);
            return {
                text: stdout.trim(),
                confidence: 0.8,
                isFinal: true,
            };
        } catch (error) {
            console.error('[Voice] Windows ASR error:', error);
            throw new Error('Windows Speech Recognition failed');
        }
    }

    /**
     * macOS Dictation
     */
    private async macOSASR(): Promise<SpeechRecognitionResult> {
        // macOS 没有直接的命令行 ASR，需要使用 AppleScript 或第三方库
        // 这里先返回占位实现
        console.warn('[Voice] macOS ASR requires additional setup');
        return {
            text: '[macOS ASR requires setup - please use plugin mode]',
            confidence: 0.0,
            isFinal: true,
        };
    }

    /**
     * Linux ASR (使用 pocketsphinx 或其他)
     */
    private async linuxASR(): Promise<SpeechRecognitionResult> {
        console.warn('[Voice] Linux ASR requires additional setup');
        return {
            text: '[Linux ASR requires setup - please use plugin mode]',
            confidence: 0.0,
            isFinal: true,
        };
    }

    /**
     * OpenAI Whisper ASR (通过 API)
     */
    private async whisperASR(): Promise<SpeechRecognitionResult> {
        console.log('[Voice] Using Whisper ASR (requires audio recording)');

        // 实际实现需要：
        // 1. 录制音频到临时文件
        // 2. 调用 Whisper API
        // 3. 返回识别结果

        throw new Error('Whisper ASR requires audio recording implementation');
    }

    /**
     * 插件 ASR (通过扩展系统)
     */
    private async pluginASR(): Promise<SpeechRecognitionResult> {
        console.log('[Voice] Using plugin ASR');

        // 通过 MCP (Model Context Protocol) 或其他插件系统调用
        // 实际实现需要集成到 CoworkAny 的插件系统

        throw new Error('Plugin ASR not yet implemented - please install voice plugin');
    }

    // ========================================================================
    // Text-to-Speech (TTS)
    // ========================================================================

    /**
     * 朗读文本
     */
    async speak(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        if (!this.config.enabled) {
            console.log('[Voice] TTS disabled, skipping speak');
            return;
        }

        return this.doSpeak(text, metadata);
    }

    /**
     * 强制朗读文本（绕过 enabled 检查）
     * 当用户通过 voice_speak 工具明确请求朗读时使用
     */
    async forcedSpeak(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        return this.doSpeak(text, metadata);
    }

    /**
     * 内部朗读实现
     */
    private async doSpeak(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        console.log(`[Voice] Speaking: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

        await this.stopSpeaking('replaced_by_new_playback');

        // Determine effective provider: if native is configured and available, use native
        // Otherwise fallback based on platform
        const provider = this.config.tts.provider;
        if (provider === 'native' || this.nativeTTSAvailable) {
            return this.nativeTTS(text, metadata);
        }

        switch (provider) {
            case 'openai':
                return this.openAITTS(text);

            case 'elevenlabs':
                return this.elevenLabsTTS(text);

            case 'plugin':
                return this.pluginTTS(text);

            default:
                // Fallback: try native TTS anyway
                return this.nativeTTS(text, metadata);
        }
    }

    private buildPreviewText(text: string): string {
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (normalized.length <= 120) {
            return normalized;
        }
        return `${normalized.slice(0, 117)}...`;
    }

    private publishPlaybackState(state: VoicePlaybackState): void {
        this.playbackState = state;
        for (const listener of this.playbackListeners) {
            try {
                listener({ ...state });
            } catch (error) {
                console.error('[Voice] Playback listener error:', error);
            }
        }
    }

    private finalizePlayback(playbackId: number, details: { reason: string; error?: string }): void {
        if (this.finalizedPlaybackIds.has(playbackId)) {
            return;
        }
        this.finalizedPlaybackIds.add(playbackId);

        const current = this.currentPlayback;
        if (current?.id === playbackId) {
            this.currentPlayback = null;
            current.cleanup?.();
        }

        this.publishPlaybackState({
            ...this.playbackState,
            isSpeaking: false,
            canStop: false,
            endedAt: new Date().toISOString(),
            reason: details.reason,
            error: details.error,
        });
    }

    private async runManagedPlayback(
        text: string,
        metadata: VoicePlaybackMetadata | undefined,
        launcher: () => Promise<{ child: ChildProcess; cleanup?: () => void }>,
    ): Promise<void> {
        const playbackId = ++this.playbackSequence;

        const startedAt = new Date().toISOString();
        const previewText = this.buildPreviewText(text);

        let launched: { child: ChildProcess; cleanup?: () => void } | null = null;
        try {
            launched = await launcher();
            this.currentPlayback = {
                id: playbackId,
                child: launched.child,
                cleanup: launched.cleanup,
            };

            this.publishPlaybackState({
                isSpeaking: true,
                canStop: true,
                previewText,
                fullTextLength: text.length,
                taskId: metadata?.taskId,
                source: metadata?.source,
                startedAt,
            });

            await new Promise<void>((resolve, reject) => {
                launched!.child.once('error', (error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    this.stopReasons.delete(playbackId);
                    this.finalizePlayback(playbackId, {
                        reason: 'process_error',
                        error: message,
                    });
                    reject(new Error(message));
                });

                launched!.child.once('close', (code, signal) => {
                    const stopReason = this.stopReasons.get(playbackId);
                    this.stopReasons.delete(playbackId);

                    if (stopReason) {
                        this.finalizePlayback(playbackId, { reason: stopReason });
                        resolve();
                        return;
                    }

                    if (code === 0) {
                        this.finalizePlayback(playbackId, { reason: 'completed' });
                        resolve();
                        return;
                    }

                    const message = `Playback exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`;
                    this.finalizePlayback(playbackId, {
                        reason: 'process_exit',
                        error: message,
                    });
                    reject(new Error(message));
                });
            });
        } catch (error) {
            if (launched) {
                launched.cleanup?.();
            }
            if (!this.finalizedPlaybackIds.has(playbackId)) {
                this.finalizePlayback(playbackId, {
                    reason: 'launch_failed',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            throw error;
        }
    }

    /**
     * 本机 TTS
     */
    private async nativeTTS(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        console.log('[Voice] Using native TTS');

        switch (this.platform) {
            case 'windows':
                return this.windowsTTS(text, metadata);

            case 'darwin':
                return this.macOSTTS(text, metadata);

            case 'linux':
                return this.linuxTTS(text, metadata);

            default:
                throw new Error('Native TTS not supported on this platform');
        }
    }

    /**
     * Windows SAPI TTS
     */
    private async windowsTTS(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        const rate = Math.round((this.config.tts.rate - 1) * 10);
        const volume = Math.round(this.config.tts.volume * 100);

        // Write text to a temporary UTF-8 file and read it from PowerShell
        // to avoid both command-line and .ps1 encoding issues with non-ASCII characters
        const tmpDir = os.tmpdir();
        const textPath = path.join(tmpDir, `coworkany_tts_text_${Date.now()}.txt`);
        const scriptPath = path.join(tmpDir, `coworkany_tts_${Date.now()}.ps1`);

        // PowerShell script reads text from the UTF-8 file
        // Using UTF-8 BOM (\ufeff) so PowerShell 5.x reads the .ps1 correctly
        const scriptContent = [
            'Add-Type -AssemblyName System.Speech',
            `$text = [System.IO.File]::ReadAllText('${textPath.replace(/\\/g, '\\\\')}', [System.Text.Encoding]::UTF8)`,
            '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
            `$synth.Rate = ${rate}`,
            `$synth.Volume = ${volume}`,
            '$synth.Speak($text)',
            '$synth.Dispose()',
        ].join('\r\n');

        // Write the text as UTF-8 with BOM so PowerShell reads it correctly
        const BOM = '\ufeff';
        fs.writeFileSync(textPath, BOM + text, 'utf-8');
        fs.writeFileSync(scriptPath, BOM + scriptContent, 'utf-8');

        try {
            await this.runManagedPlayback(text, metadata, async () => ({
                child: spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
                    stdio: 'ignore',
                }),
                cleanup: () => {
                    try { fs.unlinkSync(textPath); } catch { /* ignore */ }
                    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
                },
            }));
        } catch (error) {
            console.error('[Voice] Windows TTS error:', error);
            throw new Error(`Windows TTS failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * macOS 'say' TTS
     */
    private async macOSTTS(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        const rate = Math.round(this.config.tts.rate * 200);  // 默认 200 wpm
        const textPath = path.join(os.tmpdir(), `coworkany_tts_text_${Date.now()}.txt`);
        const textToSpeak = normalizeMacOSTextForSpeech(text);
        const resolvedVoice = await this.resolveMacOSVoice(textToSpeak);
        fs.writeFileSync(textPath, textToSpeak, 'utf-8');

        try {
            await this.runManagedPlayback(text, metadata, async () => {
                const args = ['-r', String(rate), '-f', textPath];
                if (resolvedVoice) {
                    args.unshift(resolvedVoice);
                    args.unshift('-v');
                }

                return {
                    child: spawn('say', args, { stdio: 'ignore' }),
                    cleanup: () => {
                        try { fs.unlinkSync(textPath); } catch { /* ignore */ }
                    },
                };
            });
        } catch (error) {
            console.error('[Voice] macOS TTS error:', error);
            throw new Error('macOS TTS failed');
        }
    }

    private async resolveMacOSVoice(text: string): Promise<string | null> {
        if (this.config.tts.voice !== 'default') {
            return this.config.tts.voice;
        }

        if (!containsCjk(text)) {
            return null;
        }

        try {
            const { stdout } = await execAsync("say -v '?'");
            const availableVoices = stdout
                .split('\n')
                .map((line) => line.trim().split(/\s+/)[0])
                .filter(Boolean);

            for (const voice of MACOS_PREFERRED_CJK_VOICES) {
                if (availableVoices.includes(voice)) {
                    return voice;
                }
            }
        } catch (error) {
            console.warn('[Voice] Failed to resolve preferred macOS voice:', error);
        }

        return null;
    }

    /**
     * Linux espeak TTS
     */
    private async linuxTTS(text: string, metadata?: VoicePlaybackMetadata): Promise<void> {
        const rate = Math.round(this.config.tts.rate * 150);  // espeak 默认 175 wpm
        const volume = Math.round(this.config.tts.volume * 100);
        const textPath = path.join(os.tmpdir(), `coworkany_tts_text_${Date.now()}.txt`);
        fs.writeFileSync(textPath, text, 'utf-8');

        try {
            const { stdout } = await execAsync('which espeak-ng || which espeak || which festival');
            const binary = stdout.trim().split('\n')[0];
            if (!binary) {
                throw new Error('No Linux TTS binary found');
            }

            await this.runManagedPlayback(text, metadata, async () => {
                const args = binary.includes('festival')
                    ? ['--tts', textPath]
                    : ['-s', String(rate), '-a', String(volume), '-f', textPath];

                return {
                    child: spawn(binary, args, { stdio: 'ignore' }),
                    cleanup: () => {
                        try { fs.unlinkSync(textPath); } catch { /* ignore */ }
                    },
                };
            });
        } catch (error) {
            console.error('[Voice] Linux TTS error:', error);
            throw new Error('Linux TTS failed');
        }
    }

    /**
     * OpenAI TTS API
     */
    private async openAITTS(text: string): Promise<void> {
        console.log('[Voice] Using OpenAI TTS');

        // 实际实现需要：
        // 1. 调用 OpenAI TTS API
        // 2. 获取音频文件
        // 3. 播放音频

        throw new Error('OpenAI TTS requires API integration');
    }

    /**
     * ElevenLabs TTS API
     */
    private async elevenLabsTTS(text: string): Promise<void> {
        console.log('[Voice] Using ElevenLabs TTS');
        throw new Error('ElevenLabs TTS requires API integration');
    }

    /**
     * 插件 TTS
     */
    private async pluginTTS(text: string): Promise<void> {
        console.log('[Voice] Using plugin TTS');
        throw new Error('Plugin TTS not yet implemented - please install voice plugin');
    }

    // ========================================================================
    // Wake Word Detection
    // ========================================================================

    /**
     * 监听唤醒词
     */
    async listenForWakeWord(): Promise<boolean> {
        if (!this.config.wakeWord?.enabled) {
            return false;
        }

        console.log(`[Voice] Listening for wake words: ${this.config.wakeWord.words.join(', ')}`);

        // 实际实现需要持续的音频流处理
        // 可以使用 porcupine (Picovoice) 等库

        return false;
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * 列出可用的语音
     */
    async listVoices(): Promise<Array<{ id: string; name: string; language: string }>> {
        const voices: Array<{ id: string; name: string; language: string }> = [];

        try {
            switch (this.platform) {
                case 'windows':
                    // PowerShell 列出 SAPI 语音
                    const { stdout: winVoices } = await execAsync(
                        'powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Select-Object -ExpandProperty VoiceInfo | Select-Object Name, Culture | ConvertTo-Json"'
                    );
                    const winData = JSON.parse(winVoices);
                    return Array.isArray(winData)
                        ? winData.map((v: any) => ({ id: v.Name, name: v.Name, language: v.Culture }))
                        : [{ id: winData.Name, name: winData.Name, language: winData.Culture }];

                case 'darwin':
                    // macOS 列出可用语音
                    const { stdout: macVoices } = await execAsync('say -v ?');
                    const lines = macVoices.trim().split('\n');
                    return lines.map(line => {
                        const match = line.match(/^(\S+)\s+(\S+)/);
                        return {
                            id: match?.[1] || 'unknown',
                            name: match?.[1] || 'unknown',
                            language: match?.[2] || 'en-US',
                        };
                    });

                case 'linux':
                    // Linux voices (limited)
                    return [{ id: 'default', name: 'Default', language: 'en-US' }];

                default:
                    return [];
            }
        } catch (error) {
            console.error('[Voice] Failed to list voices:', error);
            return [];
        }
    }

    /**
     * 测试语音
     */
    async testVoice(): Promise<void> {
        console.log('[Voice] Testing voice...');
        await this.speak('Hello, this is a voice test. Can you hear me?');
    }

    /**
     * 获取配置
     */
    getConfig(): VoiceConfig {
        return { ...this.config };
    }

    getPlaybackState(): VoicePlaybackState {
        return { ...this.playbackState };
    }

    subscribeToPlaybackState(listener: (state: VoicePlaybackState) => void): () => void {
        this.playbackListeners.add(listener);
        listener(this.getPlaybackState());
        return () => {
            this.playbackListeners.delete(listener);
        };
    }

    async stopSpeaking(reason = 'user_requested'): Promise<boolean> {
        const current = this.currentPlayback;
        if (!current && !this.playbackState.isSpeaking) {
            return false;
        }

        if (current) {
            this.stopReasons.set(current.id, reason);
            this.finalizePlayback(current.id, { reason });
            try {
                current.child.kill('SIGTERM');
            } catch (error) {
                console.warn('[Voice] Failed to stop playback cleanly:', error);
            }
            return true;
        }

        this.publishPlaybackState({
            ...this.playbackState,
            isSpeaking: false,
            canStop: false,
            endedAt: new Date().toISOString(),
            reason,
        });
        return true;
    }

    /**
     * 更新配置
     */
    updateConfig(updates: Partial<VoiceConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    /**
     * 检查是否可用
     */
    isAvailable(): {
        asr: boolean;
        tts: boolean;
        platform: string;
    } {
        return {
            asr: this.nativeASRAvailable || this.config.asr.provider !== 'native',
            tts: this.nativeTTSAvailable || this.config.tts.provider !== 'native',
            platform: this.platform,
        };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createVoiceInterface(config?: Partial<VoiceConfig>): VoiceInterface {
    return new VoiceInterface(config);
}
