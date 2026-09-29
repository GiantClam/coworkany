from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path
from time import sleep, time

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("AI_ENTRY_E2E_BASE_URL", "http://127.0.0.1:3000").strip().rstrip("/")
SCENARIO = os.environ.get("AI_ENTRY_E2E_SCENARIO", "consulting-model-default-ui").strip()
ARTIFACT_DIR = Path("artifacts") / "ai-entry" / SCENARIO
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_AGENT_MODEL_ID = "grok-4.5"
SWITCHABLE_MODEL_ID = "gpt-5.5"
DEFAULT_NORMAL_MODEL_ID = "gpt-5.4"
KNOWLEDGE_DATASET_ID = 101
KNOWLEDGE_DATASET_NAME = "品牌规范"


def expect(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def wait_until_http_ready(timeout_seconds: int = 180):
    deadline = time() + timeout_seconds
    last_error = None
    while time() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE_URL}/api/health", timeout=10) as response:
                body = response.read().decode("utf-8", errors="ignore")
                if response.status == 200 and '"ok":true' in body:
                    return
        except Exception as error:  # noqa: BLE001
            last_error = error
        sleep(1)
    raise RuntimeError(f"application did not become ready: {last_error}")


def save_debug(page, name: str):
    page.screenshot(path=str(ARTIFACT_DIR / f"{name}.png"), full_page=True)
    (ARTIFACT_DIR / f"{name}.html").write_text(page.content(), encoding="utf-8")


def login(context, page):
    page.goto(f"{BASE_URL}/login", timeout=90000, wait_until="domcontentloaded")

    login_response = context.request.post(f"{BASE_URL}/api/auth/demo", timeout=90000)
    if not login_response.ok:
        login_response = context.request.post(
            f"{BASE_URL}/api/auth/login",
            timeout=90000,
            headers={"Content-Type": "application/json"},
            data='{"email":"demo@example.com","password":"demo123456"}',
        )
    expect(login_response.ok, f"login failed: {login_response.status}")

    page.goto(f"{BASE_URL}/dashboard", timeout=90000, wait_until="domcontentloaded")


def wait_for_chat_interactive(page, timeout_ms: int = 60000):
    deadline = time() + (timeout_ms / 1000)
    while time() < deadline:
        textarea = page.locator("textarea:visible").first
        if textarea.count() > 0 and not textarea.is_disabled():
            return textarea
        page.wait_for_timeout(250)
    raise AssertionError("ai chat textarea did not become interactive")


def wait_for_chat_request_count(requests: list[dict], expected_count: int, timeout_seconds: int = 30):
    deadline = time() + timeout_seconds
    while time() < deadline:
        if len(requests) >= expected_count:
            return
        sleep(0.2)
    raise AssertionError(f"chat request count not reached: expected={expected_count}, actual={len(requests)}")


def run():
    wait_until_http_ready()

    result: dict[str, object] = {
        "scenario": SCENARIO,
        "base_url": BASE_URL,
        "default_agent_model_id": DEFAULT_AGENT_MODEL_ID,
        "switchable_model_id": SWITCHABLE_MODEL_ID,
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1460, "height": 1020})
        page = context.new_page()
        page.set_default_timeout(20000)

        chat_requests: list[dict] = []
        model_requests: list[str] = []
        console_errors: list[str] = []

        def on_console(msg):
            if msg.type == "error":
                console_errors.append(msg.text)

        def route_models(route):
            model_requests.append(route.request.url)
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "providerId": "aiberm",
                        "selectedModelId": DEFAULT_NORMAL_MODEL_ID,
                        "modelGroups": [
                            {
                                "family": "anthropic",
                                "label": "Anthropic",
                                "models": [
                                    {
                                        "id": DEFAULT_AGENT_MODEL_ID,
                                        "name": "PPToken / Grok 4.5",
                                        "providerId": "pptoken",
                                        "modelId": DEFAULT_AGENT_MODEL_ID,
                                    },
                                ],
                            },
                            {
                                "family": "openai",
                                "label": "OpenAI",
                                "models": [
                                    {"id": DEFAULT_NORMAL_MODEL_ID, "name": "GPT 5.4"},
                                    {"id": SWITCHABLE_MODEL_ID, "name": "GPT 5.5"},
                                ],
                            },
                        ],
                    }
                ),
            )

        def route_agents(route):
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "defaultAgentId": "general",
                        "groups": [
                            {"id": "general", "label": {"zh": "通用", "en": "General"}},
                            {"id": "executive", "label": {"zh": "专家", "en": "Executive"}},
                        ],
                        "agents": [
                            {
                                "id": "general",
                                "category": "general",
                                "name": {"zh": "通用助手", "en": "General Assistant"},
                                "description": {"zh": "default", "en": "default"},
                            },
                            {
                                "id": "executive-diagnostic",
                                "category": "executive",
                                "name": {"zh": "经营诊断顾问", "en": "Executive Diagnostic Advisor"},
                                "description": {"zh": "consulting", "en": "consulting"},
                            },
                        ],
                    }
                ),
            )

        def route_knowledge_datasets(route):
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "data": {
                            "items": [
                                {
                                    "id": KNOWLEDGE_DATASET_ID,
                                    "name": KNOWLEDGE_DATASET_NAME,
                                    "category": "enterprise",
                                    "enabled": True,
                                }
                            ]
                        }
                    }
                ),
            )

        def route_chat(route):
            try:
                raw = route.request.post_data or "{}"
                body = json.loads(raw) if raw else {}
                if not isinstance(body, dict):
                    body = {}
                chat_requests.append(body)
                request_index = len(chat_requests)
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "message": f"smoke test passed #{request_index}",
                            "conversationId": f"mock-conv-{request_index}",
                            "agentId": (
                                body.get("agentConfig", {}).get("agentId")
                                if isinstance(body.get("agentConfig"), dict)
                                else None
                            ),
                            "provider": "fixture",
                            "providerModel": (
                                body.get("modelConfig", {}).get("modelId")
                                if isinstance(body.get("modelConfig"), dict)
                                else None
                            ),
                        }
                    ),
                )
            except Exception:  # noqa: BLE001
                route.fulfill(
                    status=500,
                    content_type="application/json",
                    body=json.dumps({"error": "mock_route_chat_failed"}),
                )

        page.on("console", on_console)
        page.route("**/api/ai/models", route_models)
        page.route("**/api/ai/agents", route_agents)
        page.route("**/api/knowledge/datasets", route_knowledge_datasets)
        page.route("**/api/ai/chat", route_chat)

        try:
            login(context, page)

            # Scenario 1: consulting advisor entry defaults to Grok but keeps
            # the selector available for an explicit user switch.
            page.goto(
                f"{BASE_URL}/dashboard/ai?entry=consulting-advisor",
                timeout=90000,
                wait_until="domcontentloaded",
            )
            page.locator("[data-slot='model-reasoning-trigger']:visible").wait_for(state="visible")
            save_debug(page, "01-consulting-entry")

            model_trigger = page.locator("[data-slot='model-reasoning-trigger']:visible")
            expect(
                model_trigger.count() == 1,
                f"consulting entry should show one combined model/reasoning trigger, got={model_trigger.count()}",
            )
            expect(
                page.locator("button[role='combobox']:visible").count() == 0,
                "consulting entry should not expose separate model/reasoning comboboxes",
            )
            expect(page.get_by_text(re.compile(r"grok\s*4\.?5", re.IGNORECASE)).count() >= 1, "consulting entry should default to grok-4.5")

            composer_shell = page.locator(".ai-entry-composer-shell:visible").first
            shell_box = composer_shell.bounding_box()
            expect(shell_box is not None and shell_box["height"] <= 56, f"empty composer shell must be <=56px, got={shell_box}")

            textarea = wait_for_chat_interactive(page)
            textarea.fill("line one\nline two\nline three")
            page.wait_for_timeout(100)
            three_line_metrics = textarea.evaluate(
                """(node) => ({height: node.getBoundingClientRect().height, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowY: getComputedStyle(node).overflowY})"""
            )
            expect(three_line_metrics["height"] <= 76, f"textarea should cap at three lines, got={three_line_metrics}")

            textarea.fill("line one\nline two\nline three\nline four")
            page.wait_for_timeout(100)
            four_line_metrics = textarea.evaluate(
                """(node) => ({height: node.getBoundingClientRect().height, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowY: getComputedStyle(node).overflowY})"""
            )
            expect(four_line_metrics["clientHeight"] <= 76, f"textarea should remain capped on fourth line, got={four_line_metrics}")
            expect(four_line_metrics["scrollHeight"] > four_line_metrics["clientHeight"], f"fourth line should scroll internally, got={four_line_metrics}")
            expect(four_line_metrics["overflowY"] in {"auto", "scroll"}, f"fourth line should enable scrolling, got={four_line_metrics}")

            model_trigger.click()
            page.get_by_role("option", name=re.compile(r"grok\s*4\.?5", re.IGNORECASE)).click()
            page.get_by_role("option", name=re.compile(r"gpt\s*5\.5", re.IGNORECASE)).click()

            page.get_by_role("option", name=re.compile(r"^(high|高)$", re.IGNORECASE)).click()

            add_trigger = page.get_by_role("button", name=re.compile(r"(add content|添加内容)", re.IGNORECASE)).first
            add_trigger.click()
            add_menu = page.locator("[data-slot='prompt-input-action-menu-content']:visible")
            expect(add_menu.get_by_text(re.compile(r"(upload|上传).*(file|文件)|(file|文件).*(upload|上传)", re.IGNORECASE)).count() >= 1, "add menu should expose file upload")
            expect(add_menu.get_by_text(re.compile(r"knowledge|知识库", re.IGNORECASE)).count() >= 1, "add menu should expose knowledge selection")
            add_menu.get_by_text(re.compile(r"knowledge|知识库", re.IGNORECASE)).click()
            page.locator("[data-slot='knowledge-picker']:visible").wait_for(state="visible")
            save_debug(page, "01b-knowledge-picker")
            page.get_by_role("option", name=re.compile(re.escape(KNOWLEDGE_DATASET_NAME), re.IGNORECASE)).click()
            expect(page.get_by_text(KNOWLEDGE_DATASET_NAME, exact=True).count() >= 1, "selected knowledge dataset should render a context chip")
            page.keyboard.press("Escape")
            expect(
                page.locator("button:visible").filter(has_text=re.compile(r"knowledge|知识库", re.IGNORECASE)).count() == 0,
                "knowledge should not remain as a permanent standalone control",
            )

            textarea.fill("consulting flow lock test")
            page.get_by_role("button", name=re.compile(r"send", re.IGNORECASE)).last.click()

            wait_for_chat_request_count(chat_requests, 1)
            save_debug(page, "02-consulting-after-send")

            first_request = chat_requests[0]
            first_agent_config = first_request.get("agentConfig", {})
            first_model_config = first_request.get("modelConfig", {})
            expect(isinstance(first_agent_config, dict), "first request missing agentConfig")
            expect(isinstance(first_model_config, dict), "first request missing modelConfig")
            expect(
                not str(first_agent_config.get("agentId") or "").strip(),
                f"consulting request should not force agentId: {first_agent_config}",
            )
            expect(
                str(first_agent_config.get("entryMode") or "").strip() == "consulting-advisor",
                f"consulting entryMode missing: {first_agent_config}",
            )
            expect(
                str(first_model_config.get("modelId") or "").strip() == SWITCHABLE_MODEL_ID,
                f"consulting model switch not applied: {first_model_config}",
            )
            expect(
                str(first_model_config.get("reasoningEffort") or "").strip().lower() == "high",
                f"consulting reasoning switch not applied: {first_model_config}",
            )
            first_knowledge_config = first_request.get("enterpriseKnowledge", {})
            expect(isinstance(first_knowledge_config, dict), "first request missing enterpriseKnowledge")
            expect(first_knowledge_config.get("enabled") is True, f"knowledge should be enabled: {first_knowledge_config}")
            expect(first_knowledge_config.get("datasetIds") == [KNOWLEDGE_DATASET_ID], f"knowledge dataset mismatch: {first_knowledge_config}")

            # Scenario 2: a business/Agent Platform agent starts from Grok too.
            page.evaluate("localStorage.clear()")
            page.goto(
                f"{BASE_URL}/dashboard/ai?agent=general",
                timeout=90000,
                wait_until="domcontentloaded",
            )
            page.locator("[data-slot='model-reasoning-trigger']:visible").wait_for(state="visible")
            save_debug(page, "03-normal-entry")

            expect(
                page.locator("[data-slot='model-reasoning-trigger']:visible").count() == 1,
                "normal ai page should show one combined model/reasoning trigger",
            )
            expect(
                page.locator("button[role='combobox']:visible").count() == 0,
                "normal ai page should not restore separate model/reasoning comboboxes",
            )
            expect(page.get_by_text(re.compile(r"grok\s*4\.?5", re.IGNORECASE)).count() >= 1, "business agent should default to grok-4.5")

            textarea = wait_for_chat_interactive(page)
            textarea.fill("normal flow switch model test")
            page.get_by_role("button", name=re.compile(r"send", re.IGNORECASE)).last.click()

            wait_for_chat_request_count(chat_requests, 2)
            save_debug(page, "04-normal-after-send")

            second_request = chat_requests[1]
            second_agent_config = second_request.get("agentConfig", {})
            second_model_config = second_request.get("modelConfig", {})
            expect(isinstance(second_agent_config, dict), "second request missing agentConfig")
            expect(isinstance(second_model_config, dict), "second request missing modelConfig")
            expect(
                str(second_agent_config.get("agentId") or "").strip() == "general",
                f"normal request agent id mismatch: {second_agent_config}",
            )
            expect(
                "entryMode" not in second_agent_config
                or not str(second_agent_config.get("entryMode") or "").strip(),
                f"normal request should not carry consulting entryMode: {second_agent_config}",
            )
            expect(
                str(second_model_config.get("modelId") or "").strip() == DEFAULT_AGENT_MODEL_ID,
                f"business agent default model mismatch: {second_model_config}",
            )

            critical_console_errors = [
                item
                for item in console_errors
                if "favicon" not in item.lower()
                and "failed to load resource" not in item.lower()
                and "_vercel/insights" not in item.lower()
                # Playwright hides the caret while taking screenshots. React can
                # observe that temporary inline style during hydration in dev.
                and not ("hydrated" in item.lower() and "caret-color" in item.lower())
            ]
            expect(
                not critical_console_errors,
                f"critical console errors found: {critical_console_errors[:5]}",
            )

            result["ok"] = True
            result["chat_request_count"] = len(chat_requests)
            result["model_request_count"] = len(model_requests)
            result["final_url"] = page.url
            result["first_request"] = {
                "agentConfig": first_agent_config,
                "modelConfig": first_model_config,
                "enterpriseKnowledge": first_knowledge_config,
            }
            result["second_request"] = {
                "agentConfig": second_agent_config,
                "modelConfig": second_model_config,
            }
        finally:
            browser.close()

    (ARTIFACT_DIR / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("AI_ENTRY_CONSULTING_MODEL_LOCK_UI_E2E_SUMMARY_START")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("AI_ENTRY_CONSULTING_MODEL_LOCK_UI_E2E_SUMMARY_END")


if __name__ == "__main__":
    try:
        run()
    except (AssertionError, PlaywrightTimeoutError, Exception) as error:  # noqa: BLE001
        print(f"ai_entry_consulting_model_lock_ui_e2e: FAIL: {error}")
        raise
