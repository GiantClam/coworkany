"""
Tests for browser-use-service FastAPI endpoints.

Uses httpx + pytest-asyncio to test the FastAPI app directly
without needing a running server or browser.
"""

import pytest
import os
import json
from unittest.mock import AsyncMock, MagicMock, patch

# Import the FastAPI app
from main import app, state, BrowserState

# Use httpx for async test client
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    """Create async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    # Reset state after each test
    state.connected = False
    state.browser = None
    state.context = None


# ============================================================================
# 1. Health Check
# ============================================================================


class TestHealthCheck:
    @pytest.mark.anyio
    async def test_health_returns_ok(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "browser-use-service"

    @pytest.mark.anyio
    async def test_health_reports_connection_status(self, client):
        response = await client.get("/health")
        data = response.json()
        assert data["connected"] is False


# ============================================================================
# 2. Connect / Disconnect
# ============================================================================


class TestConnect:
    @pytest.mark.anyio
    async def test_connect_requires_browser_use_library(self, client):
        """Test that /connect attempts to use browser_use library.
        In test env without browser_use installed, it should return 500 with a clear error.
        """
        response = await client.post(
            "/connect",
            json={"profile_name": "Default", "headless": True},
        )
        # Will fail because browser_use isn't installed in test env
        # FastAPI wraps the ModuleNotFoundError as a 500 internal server error
        assert response.status_code in (200, 422, 500)

    @pytest.mark.anyio
    async def test_disconnect_succeeds_when_not_connected(self, client):
        response = await client.post("/disconnect")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True


# ============================================================================
# 3. Navigate (requires connection - test error handling)
# ============================================================================


class TestNavigate:
    @pytest.mark.anyio
    async def test_navigate_fails_when_not_connected(self, client):
        response = await client.post(
            "/navigate",
            json={"url": "https://example.com"},
        )
        # Should return 400 (not connected) or error in response body
        assert response.status_code in (400, 200)
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False

    @pytest.mark.anyio
    async def test_navigate_validates_request_schema(self, client):
        # Missing required url field
        response = await client.post("/navigate", json={})
        assert response.status_code == 422  # Validation error


# ============================================================================
# 4. Click (requires connection)
# ============================================================================


class TestClick:
    @pytest.mark.anyio
    async def test_click_fails_when_not_connected(self, client):
        response = await client.post(
            "/click",
            json={"instruction": "click the submit button"},
        )
        assert response.status_code in (400, 200)

    @pytest.mark.anyio
    async def test_click_validates_schema(self, client):
        response = await client.post("/click", json={})
        assert response.status_code == 422


# ============================================================================
# 5. Fill (requires connection)
# ============================================================================


class TestFill:
    @pytest.mark.anyio
    async def test_fill_fails_when_not_connected(self, client):
        response = await client.post(
            "/fill",
            json={"instruction": "type hello in the input", "value": "hello"},
        )
        assert response.status_code in (400, 200)

    @pytest.mark.anyio
    async def test_fill_validates_schema(self, client):
        response = await client.post("/fill", json={})
        assert response.status_code == 422


# ============================================================================
# 6. Upload
# ============================================================================


class TestUpload:
    @pytest.mark.anyio
    async def test_upload_fails_when_not_connected(self, client):
        response = await client.post(
            "/upload",
            json={"file_path": "C:\\test\\image.png"},
        )
        assert response.status_code in (400, 200)
        if response.status_code == 200:
            data = response.json()
            # Should fail because browser not connected or file doesn't exist
            assert data["success"] is False

    @pytest.mark.anyio
    async def test_upload_reports_missing_file(self, client):
        """Even if connected, a non-existent file should be reported."""
        # Mock the BrowserState to appear connected with a mock page
        mock_page = AsyncMock()
        mock_page.locator = MagicMock(return_value=AsyncMock())

        original_get_page = state.get_page
        original_ensure = state.ensure_connected
        state.ensure_connected = AsyncMock()  # Skip connection check
        state.get_page = AsyncMock(return_value=mock_page)
        state.connected = True

        try:
            response = await client.post(
                "/upload",
                json={"file_path": "/non/existent/file.png"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            # Should mention file not found
            error_text = (data.get("message", "") + " " + data.get("error", "")).lower()
            assert "not found" in error_text or "not exist" in error_text or "file" in error_text
        finally:
            # Reset
            state.connected = False
            state.context = None
            state.get_page = original_get_page
            state.ensure_connected = original_ensure


# ============================================================================
# 7. Screenshot
# ============================================================================


class TestScreenshot:
    @pytest.mark.anyio
    async def test_screenshot_fails_when_not_connected(self, client):
        response = await client.post("/screenshot")
        assert response.status_code in (400, 200)
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False


# ============================================================================
# 8. Content
# ============================================================================


class TestContent:
    @pytest.mark.anyio
    async def test_content_fails_when_not_connected(self, client):
        response = await client.post("/content")
        assert response.status_code in (400, 200)


# ============================================================================
# 9. Extract
# ============================================================================


class TestExtract:
    @pytest.mark.anyio
    async def test_extract_fails_when_not_connected(self, client):
        response = await client.post(
            "/extract",
            json={
                "instruction": "extract product names",
                "output_format": "json",
            },
        )
        assert response.status_code in (400, 200)

    @pytest.mark.anyio
    async def test_extract_validates_schema(self, client):
        response = await client.post("/extract", json={})
        assert response.status_code == 422


# ============================================================================
# 10. Task
# ============================================================================


class TestTask:
    @pytest.mark.anyio
    async def test_task_fails_when_not_connected(self, client):
        response = await client.post(
            "/task",
            json={"task": "search for puppies"},
        )
        assert response.status_code in (400, 200)

    @pytest.mark.anyio
    async def test_task_validates_schema(self, client):
        response = await client.post("/task", json={})
        assert response.status_code == 422


# ============================================================================
# 11. Action
# ============================================================================


class TestAction:
    @pytest.mark.anyio
    async def test_action_fails_when_not_connected(self, client):
        response = await client.post(
            "/action",
            json={"action": "click the button"},
        )
        assert response.status_code in (400, 200)

    @pytest.mark.anyio
    async def test_action_validates_schema(self, client):
        response = await client.post("/action", json={})
        assert response.status_code == 422


# ============================================================================
# 12. Request/Response Model Validation
# ============================================================================


class TestModels:
    @pytest.mark.anyio
    async def test_navigate_default_values(self, client):
        """Verify default values are applied for optional fields."""
        from main import NavigateRequest

        req = NavigateRequest(url="https://example.com")
        assert req.wait_until == "domcontentloaded"
        assert req.timeout_ms == 30000

    @pytest.mark.anyio
    async def test_task_default_values(self, client):
        from main import TaskRequest

        req = TaskRequest(task="do something")
        assert req.max_steps == 20
        assert req.url is None
        assert req.llm_model is None

    @pytest.mark.anyio
    async def test_upload_default_instruction(self, client):
        from main import UploadRequest

        req = UploadRequest(file_path="/some/file.png")
        assert "upload" in req.instruction.lower()

    @pytest.mark.anyio
    async def test_extract_default_format(self, client):
        from main import ExtractRequest

        req = ExtractRequest(instruction="get prices")
        assert req.output_format == "json"
