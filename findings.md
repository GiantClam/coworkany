# Findings

- Current TTS is sidecar built-in via `voice_speak` in `sidecar/src/tools/core/voice.ts`.
- Current ASR entrypoint is desktop hook `desktop/src/hooks/useVoiceInput.ts`, with fallback to Tauri command `transcribe_audio`.
- Installed skills declare `allowedTools`, but there is no existing extension point for registering ASR/TTS providers.
- Implemented a minimal speech provider contract through `skill.manifest.metadata.voice.asr|tts`.
- Custom providers are only considered when the backing tool actually exists in the runtime tool registry.
- Desktop now asks sidecar for voice provider status before choosing between system-native recognition and recorded-audio transcription.
