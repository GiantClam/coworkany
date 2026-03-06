# Progress

- Implemented backend changes in process manager:
  - persistent cache env for sentence-transformers
  - proxy injection from llm-config/env
  - predownload embedding model API
- Added IPC command `prepare_rag_embedding_model` and registered it in Tauri invoke handler.
- Updated setup onboarding:
  - API step now includes proxy toggle/url/bypass inputs
  - saves proxy into llm config
  - triggers one-time model predownload and user toast feedback
- Prevented service warmup during setup wizard (`showSetup` gating) so startup does not race before proxy setup.
- Validation:
  - `cargo check` passed
  - `pnpm -C desktop exec tsc --noEmit` passed

