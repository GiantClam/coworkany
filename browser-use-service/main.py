"""
CoworkAny - Browser Use Service

A FastAPI service wrapping the browser-use library for AI-driven browser automation.
Provides both high-level natural language task execution and low-level browser operations.
Designed to be called from the TypeScript sidecar via HTTP.
"""

import os
import sys
import asyncio
import base64
import logging
import platform
from pathlib import Path
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("browser-use-service")

# ---------------------------------------------------------------------------
# Lazy imports – browser_use is heavy, only import when needed
# ---------------------------------------------------------------------------

_browser = None
_browser_context = None
_agent_browser = None  # browser-use Browser wrapper


def _get_chrome_user_data_dir() -> str:
    """Return the Chrome user data directory for the current OS."""
    system = platform.system()
    if system == "Windows":
        return os.path.join(
            os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "User Data"
        )
    elif system == "Darwin":
        return os.path.join(
            Path.home(), "Library", "Application Support", "Google", "Chrome"
        )
    else:  # Linux
        return os.path.join(Path.home(), ".config", "google-chrome")


def _get_chrome_executable() -> Optional[str]:
    """Return path to Chrome executable if found."""
    system = platform.system()
    candidates = []
    if system == "Windows":
        for base in [
            os.environ.get("PROGRAMFILES", ""),
            os.environ.get("PROGRAMFILES(X86)", ""),
            os.environ.get("LOCALAPPDATA", ""),
        ]:
            if base:
                candidates.append(
                    os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")
                )
    elif system == "Darwin":
        candidates.append(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )
    else:
        candidates.extend(
            [
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/chromium-browser",
            ]
        )

    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ConnectRequest(BaseModel):
    profile_name: str = Field(
        default="Default", description="Chrome profile directory name"
    )
    headless: bool = Field(default=False, description="Run in headless mode")
    cdp_url: Optional[str] = Field(
        default=None, description="Connect to existing browser via CDP URL"
    )


class ConnectResponse(BaseModel):
    success: bool
    message: str
    profile: str = ""


class NavigateRequest(BaseModel):
    url: str
    wait_until: str = Field(
        default="domcontentloaded", description="load | domcontentloaded | networkidle"
    )
    timeout_ms: int = Field(default=30000)
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class NavigateResponse(BaseModel):
    success: bool
    url: str = ""
    title: str = ""
    error: Optional[str] = None


class ClickRequest(BaseModel):
    instruction: str = Field(
        description="Natural language instruction for what to click, e.g. 'click the login button'"
    )
    selector: Optional[str] = Field(
        default=None, description="Optional CSS selector as hint"
    )
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class FillRequest(BaseModel):
    instruction: str = Field(
        description="Natural language instruction, e.g. 'type hello@email.com in the email field'"
    )
    selector: Optional[str] = Field(
        default=None, description="Optional CSS selector as hint"
    )
    value: Optional[str] = Field(
        default=None, description="Value to fill if not in instruction"
    )
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class UploadRequest(BaseModel):
    file_path: str = Field(description="Absolute path to the file to upload")
    instruction: str = Field(
        default="click the file upload button and upload the file",
        description="Natural language instruction for finding the upload element",
    )
    selector: Optional[str] = Field(
        default=None, description="Optional CSS selector for file input"
    )
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class UploadResponse(BaseModel):
    success: bool
    message: str
    error: Optional[str] = None


class ScreenshotResponse(BaseModel):
    success: bool
    image_base64: str = ""
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class ExtractRequest(BaseModel):
    instruction: str = Field(
        description="What data to extract, e.g. 'extract all product names and prices'"
    )
    output_format: str = Field(default="json", description="json | text | markdown")
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class ExtractResponse(BaseModel):
    success: bool
    data: Optional[str] = None
    error: Optional[str] = None


class TaskRequest(BaseModel):
    task: str = Field(description="Natural language task description")
    url: Optional[str] = Field(default=None, description="Optional starting URL")
    max_steps: int = Field(default=20, description="Maximum number of agent steps")
    llm_model: Optional[str] = Field(
        default=None, description="Override LLM model for this task"
    )
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class TaskResponse(BaseModel):
    success: bool
    result: Optional[str] = None
    steps_taken: int = 0
    error: Optional[str] = None


class ActionRequest(BaseModel):
    action: str = Field(description="Natural language action to perform")
    context: Optional[str] = Field(
        default=None, description="Additional context about the current page"
    )
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class TaskScopeRequest(BaseModel):
    task_key: Optional[str] = Field(
        default=None, description="Task/session key for tab isolation"
    )


class ActionResponse(BaseModel):
    success: bool
    result: Optional[str] = None
    error: Optional[str] = None


class ContentResponse(BaseModel):
    success: bool
    content: str = ""
    url: str = ""
    title: str = ""
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------


class BrowserState:
    """Holds the browser-use Browser and Agent instances."""

    def __init__(self):
        self.browser = (
            None  # browser_use.Browser (BrowserSession alias in new versions)
        )
        self.context = (
            None  # kept for backward compatibility; equals browser when available
        )
        self.connected = False
        self.profile_name = "Default"
        self.task_pages: Dict[str, Any] = {}
        self.current_cdp_url: Optional[str] = None

    def _normalize_task_key(self, task_key: Optional[str]) -> Optional[str]:
        if task_key is None:
            return None
        normalized = task_key.strip()
        return normalized if normalized else None

    async def ensure_connected(self):
        if not self.connected or self.browser is None:
            raise HTTPException(
                status_code=400,
                detail="Browser not connected. Call POST /connect first.",
            )

    async def connect(self, req: ConnectRequest):
        try:
            from browser_use import Browser
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="browser_use library is not installed. Run: pip install browser-use",
            )

        requested_cdp_url = req.cdp_url.strip() if req.cdp_url else None

        if self.connected and self.browser is not None:
            # If a CDP endpoint is requested and differs from current connection,
            # reconnect so smart mode can share the exact same Chrome instance.
            if requested_cdp_url and requested_cdp_url != self.current_cdp_url:
                logger.info(
                    "Reconnecting browser-use session to requested CDP endpoint: %s -> %s",
                    self.current_cdp_url,
                    requested_cdp_url,
                )
                await self.disconnect()
            else:
                return ConnectResponse(
                    success=True, message="Already connected", profile=self.profile_name
                )

        try:
            # browser-use >=0.12 switched to BrowserSession API.
            # Browser is now an alias of BrowserSession and takes cdp_url/headless directly.
            init_kwargs = {}

            if requested_cdp_url:
                init_kwargs["cdp_url"] = requested_cdp_url
                init_kwargs["is_local"] = False
            else:
                init_kwargs["is_local"] = True
                init_kwargs["headless"] = req.headless

                chrome_path = _get_chrome_executable()
                if chrome_path:
                    init_kwargs["executable_path"] = chrome_path

                user_data_dir = _get_chrome_user_data_dir()
                if os.path.isdir(user_data_dir):
                    init_kwargs["user_data_dir"] = user_data_dir

            self.browser = Browser(**init_kwargs)
            await self.browser.start()
            self.context = self.browser
            self.connected = True
            self.profile_name = req.profile_name
            self.current_cdp_url = requested_cdp_url

            logger.info(f"Connected to browser with profile: {req.profile_name}")
            return ConnectResponse(
                success=True, message="Connected to Chrome", profile=req.profile_name
            )

        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            self.connected = False
            self.browser = None
            self.context = None
            self.task_pages = {}
            self.current_cdp_url = None
            raise HTTPException(
                status_code=500, detail=f"Failed to connect to browser: {str(e)}"
            )

    async def disconnect(self):
        for _, task_page in list(self.task_pages.items()):
            try:
                await task_page.close()
            except Exception:
                pass
        self.task_pages = {}

        if self.browser:
            try:
                await self.browser.stop()
            except Exception as e:
                logger.warning(f"Error during disconnect: {e}")
            finally:
                self.browser = None
                self.context = None
                self.connected = False
                self.current_cdp_url = None

    async def get_page(self, task_key: Optional[str] = None):
        """Get the current active page from the browser context."""
        await self.ensure_connected()
        normalized_task_key = self._normalize_task_key(task_key)
        if normalized_task_key:
            existing_page = self.task_pages.get(normalized_task_key)
            if existing_page is not None:
                try:
                    await existing_page.bring_to_front()
                    return existing_page
                except Exception:
                    self.task_pages.pop(normalized_task_key, None)

            page = await self.browser.new_page()
            self.task_pages[normalized_task_key] = page
            try:
                await page.bring_to_front()
            except Exception:
                pass
            return page

        page = await self.browser.get_current_page()
        if page is None:
            page = await self.browser.new_page()
        return page


state = BrowserState()

# ---------------------------------------------------------------------------
# LLM helper
# ---------------------------------------------------------------------------


def _get_llm(model_override: Optional[str] = None):
    """Get a LiteLLM-compatible LLM instance for browser-use."""
    from langchain_openai import ChatOpenAI

    model = model_override or os.environ.get("BROWSER_USE_LLM_MODEL", "gpt-4o")
    api_key = os.environ.get("OPENAI_API_KEY", "")

    # Use LiteLLM proxy if configured
    base_url = os.environ.get("LITELLM_BASE_URL", None)

    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
    )


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Browser-use service starting...")
    yield
    logger.info("Browser-use service shutting down...")
    await state.disconnect()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CoworkAny Browser-Use Service",
    description="AI-driven browser automation service using browser-use",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "browser-use-service",
        "connected": state.connected,
        "task_tabs": len(state.task_pages),
    }


@app.post("/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest):
    return await state.connect(req)


@app.post("/disconnect")
async def disconnect():
    await state.disconnect()
    return {"success": True, "message": "Disconnected"}


@app.post("/navigate", response_model=NavigateResponse)
async def navigate(req: NavigateRequest):
    try:
        page = await state.get_page(req.task_key)
        await page.goto(req.url)
        title = await page.get_title()
        url = await page.get_url()
        return NavigateResponse(success=True, url=url, title=title)
    except Exception as e:
        logger.error(f"Navigate error: {e}")
        return NavigateResponse(success=False, error=str(e))


@app.post("/click", response_model=ActionResponse)
async def click(req: ClickRequest):
    """Click using AI vision to locate the element."""
    try:
        from browser_use import Agent

        await state.ensure_connected()
        await state.get_page(req.task_key)
        llm = _get_llm()

        instruction = req.instruction
        if req.selector:
            instruction += f" (hint: CSS selector '{req.selector}')"

        agent = Agent(
            task=f"On the current page, {instruction}. Do only this one action, then stop.",
            llm=llm,
            browser=state.browser,
        )
        history = await agent.run(max_steps=3)
        final = history.final_result() if history else None

        return ActionResponse(success=True, result=final or "Click action completed")
    except Exception as e:
        logger.error(f"Click error: {e}")
        return ActionResponse(success=False, error=str(e))


@app.post("/fill", response_model=ActionResponse)
async def fill(req: FillRequest):
    """Fill a form field using AI vision to locate it."""
    try:
        from browser_use import Agent

        await state.ensure_connected()
        await state.get_page(req.task_key)
        llm = _get_llm()

        instruction = req.instruction
        if req.selector:
            instruction += f" (hint: CSS selector '{req.selector}')"
        if req.value:
            instruction += f" with the value: {req.value}"

        agent = Agent(
            task=f"On the current page, {instruction}. Do only this one action, then stop.",
            llm=llm,
            browser=state.browser,
        )
        history = await agent.run(max_steps=3)
        final = history.final_result() if history else None

        return ActionResponse(success=True, result=final or "Fill action completed")
    except Exception as e:
        logger.error(f"Fill error: {e}")
        return ActionResponse(success=False, error=str(e))


@app.post("/upload", response_model=UploadResponse)
async def upload(req: UploadRequest):
    """Upload a file by finding the file input and setting files."""
    try:
        page = await state.get_page(req.task_key)

        if not os.path.isfile(req.file_path):
            return UploadResponse(
                success=False,
                message="File not found",
                error=f"File does not exist: {req.file_path}",
            )

        if req.selector:
            return UploadResponse(
                success=False,
                message="Selector-based upload is not supported in browser-use session mode",
                error="Use natural-language instruction upload flow",
            )

        # Use browser-use agent to find and interact with file upload
        from browser_use import Agent

        llm = _get_llm()
        agent = Agent(
            task=f"On the current page, {req.instruction}. The file to upload is at: {req.file_path}",
            llm=llm,
            browser=state.browser,
        )

        # Set up file chooser handler
        async def handle_file_chooser(file_chooser):
            await file_chooser.set_files(req.file_path)

        page.on("filechooser", handle_file_chooser)

        try:
            history = await agent.run(max_steps=5)
            final = history.final_result() if history else None
            return UploadResponse(success=True, message=final or "Upload completed")
        finally:
            page.remove_listener("filechooser", handle_file_chooser)

    except Exception as e:
        logger.error(f"Upload error: {e}")
        return UploadResponse(success=False, message="Upload failed", error=str(e))


@app.post("/screenshot", response_model=ScreenshotResponse)
async def screenshot(req: TaskScopeRequest = Body(default_factory=TaskScopeRequest)):
    """Take a screenshot of the current page."""
    try:
        page = await state.get_page(req.task_key)
        image_b64 = await page.screenshot()
        return ScreenshotResponse(
            success=True,
            image_base64=image_b64,
            width=1280,
            height=720,
        )
    except Exception as e:
        logger.error(f"Screenshot error: {e}")
        return ScreenshotResponse(success=False, error=str(e))


@app.post("/extract", response_model=ExtractResponse)
async def extract(req: ExtractRequest):
    """Extract structured data from the current page using AI."""
    try:
        from browser_use import Agent

        await state.ensure_connected()
        await state.get_page(req.task_key)
        llm = _get_llm()

        task = f"On the current page, {req.instruction}. Return the result as {req.output_format}."

        agent = Agent(
            task=task,
            llm=llm,
            browser=state.browser,
        )
        history = await agent.run(max_steps=5)
        final = history.final_result() if history else None

        return ExtractResponse(success=True, data=final)
    except Exception as e:
        logger.error(f"Extract error: {e}")
        return ExtractResponse(success=False, error=str(e))


@app.post("/content", response_model=ContentResponse)
async def get_content(
    as_text: bool = True,
    req: TaskScopeRequest = Body(default_factory=TaskScopeRequest),
):
    """Get page content as text or HTML."""
    try:
        page = await state.get_page(req.task_key)
        if as_text:
            content = await page.evaluate(
                "(...args) => document.body ? document.body.innerText : ''"
            )
        else:
            content = await page.evaluate(
                "(...args) => document.documentElement ? document.documentElement.outerHTML : ''"
            )

        # Limit size
        content = content[:100000]

        return ContentResponse(
            success=True,
            content=content,
            url=await page.get_url(),
            title=await page.get_title(),
        )
    except Exception as e:
        logger.error(f"Content error: {e}")
        return ContentResponse(success=False, error=str(e))


@app.post("/task", response_model=TaskResponse)
async def run_task(req: TaskRequest):
    """Execute a complete natural language browser task using browser-use Agent."""
    try:
        from browser_use import Agent

        await state.ensure_connected()
        task_page = await state.get_page(req.task_key)
        llm = _get_llm(req.llm_model)

        # Navigate to URL first if provided
        if req.url:
            await task_page.goto(req.url)

        agent = Agent(
            task=req.task,
            llm=llm,
            browser=state.browser,
        )

        history = await agent.run(max_steps=req.max_steps)
        final = history.final_result() if history else None
        steps = len(history.history) if history and hasattr(history, "history") else 0

        return TaskResponse(success=True, result=final, steps_taken=steps)

    except Exception as e:
        logger.error(f"Task error: {e}")
        return TaskResponse(success=False, error=str(e))


@app.post("/action", response_model=ActionResponse)
async def perform_action(req: ActionRequest):
    """Perform a single AI-driven browser action."""
    try:
        from browser_use import Agent

        await state.ensure_connected()
        await state.get_page(req.task_key)
        llm = _get_llm()

        task = f"On the current page, {req.action}. Do only this one action, then stop."
        if req.context:
            task += f" Context: {req.context}"

        agent = Agent(
            task=task,
            llm=llm,
            browser=state.browser,
        )
        history = await agent.run(max_steps=3)
        final = history.final_result() if history else None

        return ActionResponse(success=True, result=final or "Action completed")
    except Exception as e:
        logger.error(f"Action error: {e}")
        return ActionResponse(success=False, error=str(e))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("BROWSER_USE_PORT", "8100"))
    host = os.environ.get("BROWSER_USE_HOST", "127.0.0.1")

    logger.info(f"Starting browser-use service on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
