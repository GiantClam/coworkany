# Task Plan

## Goal
Implement a voice provider strategy so CoworkAny defaults to built-in system-native ASR/TTS, while allowing installed skills/tools to register custom ASR/TTS providers that take precedence.

## Phases
- [completed] Inspect current ASR/TTS and dynamic tool registration paths
- [completed] Design provider registry and selection policy
- [completed] Implement TTS provider override path in sidecar
- [completed] Implement ASR provider override path in desktop/Tauri
- [completed] Add tests and verify build/runtime

## Errors Encountered
- `planning-with-files` session catchup script failed due to local Python framework code-signing issue on macOS. Proceeded with manual inspection.
