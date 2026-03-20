# Progress

- 2026-03-19: Started voice provider architecture change.
- Inspected current voice TTS and ASR implementations.
- Identified missing provider registry abstraction for custom skill/tool overrides.
- Added `sidecar/src/tools/core/speechProviders.ts` and sidecar tests for provider selection.
- Wired sidecar runtime commands for provider status and custom ASR transcription.
- Wired desktop/Tauri to prefer custom ASR when installed, otherwise keep the built-in system path.
- Added persisted `voiceProviderMode` settings (`auto/system/custom`) in desktop settings.
- Propagated `voiceProviderMode` through task config, ASR status checks, transcription IPC, and sidecar TTS selection.
- Verification completed with sidecar typecheck, sidecar tests, desktop tests, desktop build, and Rust Tauri tests.
