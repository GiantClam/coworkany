# Browser-Use Service

AI-driven browser automation service for CoworkAny, powered by [browser-use](https://github.com/browser-use/browser-use).

## Setup

```bash
cd browser-use-service
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt

# Install browser-use's Chromium (if not using system Chrome)
# python -m playwright install chromium
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_USE_PORT` | `8100` | HTTP port |
| `BROWSER_USE_HOST` | `127.0.0.1` | Bind address |
| `BROWSER_USE_LLM_MODEL` | `gpt-4o` | LLM model for AI actions |
| `OPENAI_API_KEY` | (required) | API key for LLM |
| `LITELLM_BASE_URL` | (optional) | LiteLLM proxy URL |

## Run

```bash
python main.py
# or
uvicorn main:app --host 127.0.0.1 --port 8100
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/connect` | Connect to Chrome browser |
| `POST` | `/disconnect` | Disconnect browser |
| `POST` | `/navigate` | Navigate to URL |
| `POST` | `/click` | AI-driven click |
| `POST` | `/fill` | AI-driven form fill |
| `POST` | `/upload` | File upload |
| `POST` | `/screenshot` | Take screenshot |
| `POST` | `/content` | Get page content |
| `POST` | `/extract` | AI-driven data extraction |
| `POST` | `/action` | Single AI browser action |
| `POST` | `/task` | Full AI browser task |
