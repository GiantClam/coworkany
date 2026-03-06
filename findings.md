# Findings

- Using planning-with-files skill for this complex multi-step change.
- RAG default model is `all-MiniLM-L6-v2` in `rag-service/main.py`.
- RAG startup previously had no explicit persistent model cache env and no llm-config proxy injection.
- Setup wizard previously validated API key only, then app warmup could start services before setup completion.
- Added backend command `prepare_rag_embedding_model` and wired setup step to call it after proxy save.
- Added persistent env vars for rag-service and predownload command:
  - `HF_HOME=~/.coworkany/models/hf`
  - `SENTENCE_TRANSFORMERS_HOME=~/.coworkany/models/sentence-transformers`
  - `TRANSFORMERS_CACHE=~/.coworkany/models/hf/hub`
- Added proxy resolution priority for RAG:
  1) `llm-config.json` proxy if enabled
  2) environment proxy vars fallback.

