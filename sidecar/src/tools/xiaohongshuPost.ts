/* eslint-disable no-var */
// `document` is used inside page.evaluate() which runs in browser context
declare const document: any;

/**
 * Xiaohongshu (小红书) Post Compound Tool
 *
 * A single tool that encapsulates the entire Xiaohongshu posting workflow:
 * 1. Connect to browser (Chrome with user's profile)
 * 2. Navigate to publish page
 * 3. Wait for login if needed
 * 4. Upload / generate image (required by XHS)
 * 5. Fill title and content
 * 6. Click publish
 * 7. Verify success
 *
 * Community best practices applied:
 * - Images MUST exist before the title/content editor appears
 * - XHS uses non-standard elements (divs/spans) styled as buttons
 * - The tiptap contenteditable is used for rich text input
 * - Canvas + DataTransfer or Playwright setInputFiles for image upload
 * - Search ALL elements for button text, not just <button>
 */

import { ToolDefinition } from './standard';
import { browserService } from '../services/browserService';

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Execute a script and return the string result.
 * Supports async IIFEs (the bridge's page.evaluate handles Promises).
 */
async function execScript(script: string): Promise<string> {
    try {
        const result = await browserService.executeScript(script);
        return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function getPageText(): Promise<string> {
    try {
        const content = await browserService.getContent(true);
        return content.content || '';
    } catch {
        return '';
    }
}

async function getCurrentUrl(): Promise<string> {
    try {
        const content = await browserService.getContent(false);
        return content.url || '';
    } catch {
        return '';
    }
}

/**
 * Click an element by its visible text. Searches ALL elements, not just
 * <button> or [role="button"], because XHS uses styled divs/spans.
 *
 * Returns a description of what was clicked, or an error string.
 */
async function clickByText(text: string): Promise<string> {
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return execScript(`(() => {
        const target = '${escapedText}';
        const all = document.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (el.children.length > 0) continue;          // leaf nodes only
            if (el.offsetParent === null && el.style.display !== 'contents') continue; // visible
            const txt = (el.textContent || '').trim();
            if (txt === target) {
                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                // Full event sequence for Vue/React compatibility
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev => {
                    el.dispatchEvent(new PointerEvent(ev, { bubbles: true, cancelable: true, view: window }));
                });
                // Also bubble to parent (some XHS elements have the handler on the parent)
                if (el.parentElement) {
                    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev => {
                        el.parentElement.dispatchEvent(new PointerEvent(ev, { bubbles: true, cancelable: true, view: window }));
                    });
                }
                return 'clicked: ' + el.tagName + '.' + (el.className || '').substring(0, 40) + ' text=' + txt;
            }
        }
        return 'ERROR: element not found with text: ' + target;
    })()`);
}

/**
 * Diagnose current page state for debugging
 */
async function diagnosePage(): Promise<string> {
    return execScript(`(() => {
        const info = {};
        info.url = window.location.href;
        info.title = document.title;
        info.visibleText = document.body ? document.body.innerText.substring(0, 500) : '';

        // Collect ALL visible clickable-looking elements
        info.clickables = [];
        document.querySelectorAll('button, [role="button"], a, [class*="btn"], [class*="button"], [class*="publish"], [class*="submit"]').forEach(el => {
            if (el.offsetParent !== null && el.textContent && el.textContent.trim()) {
                info.clickables.push(el.tagName + '.' + (el.className || '').substring(0, 30) + ': ' + el.textContent.trim().substring(0, 30));
            }
        });

        // Also find elements with key text
        const keyTexts = ['发布', '生成图片', '发布笔记', 'Publish'];
        info.keyElements = [];
        document.querySelectorAll('*').forEach(el => {
            if (el.children.length > 0) return;
            const txt = (el.textContent || '').trim();
            if (keyTexts.some(k => txt === k) && el.offsetParent !== null) {
                info.keyElements.push(el.tagName + '.' + (el.className || '').substring(0, 30) + ': "' + txt + '"');
            }
        });

        info.contenteditables = [];
        document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            if (el.offsetParent !== null) {
                info.contenteditables.push({
                    tag: el.tagName,
                    class: (el.className || '').substring(0, 60),
                    placeholder: el.getAttribute('data-placeholder') || '',
                    height: Math.round(el.getBoundingClientRect().height),
                });
            }
        });

        info.inputs = [];
        document.querySelectorAll('input:not([type="file"]):not([type="hidden"])').forEach(el => {
            if (el.offsetParent !== null) {
                info.inputs.push({ type: el.type, placeholder: el.placeholder || '', class: (el.className || '').substring(0, 40) });
            }
        });

        info.fileInputs = document.querySelectorAll('input[type="file"]').length;
        return JSON.stringify(info);
    })()`);
}

// ============================================================================
// Login check (already fixed in previous iteration)
// ============================================================================

async function isLoggedIn(): Promise<boolean> {
    const text = await getPageText();
    const loggedInKeywords = ['发布笔记', '创作中心', '上传图文', '上传视频', '我的主页', '数据中心'];
    const loginPageKeywords = ['密码登录', '验证码登录', '扫码登录', '手机号登录'];

    const hasLoggedIn = loggedInKeywords.some(kw => text.includes(kw));
    const hasLoginPage = loginPageKeywords.some(kw => text.includes(kw));

    const snippet = text.substring(0, 300).replace(/\s+/g, ' ');
    console.log(`[XHS-Post] Login check: hasLoggedIn=${hasLoggedIn}, hasLoginPage=${hasLoginPage}, text="${snippet}..."`);

    if (hasLoggedIn) return true;
    if (hasLoginPage) return false;

    const url = await getCurrentUrl();
    if (url.includes('creator.xiaohongshu.com/publish')) {
        console.log('[XHS-Post] Login check: on publish page but no keywords yet, assuming loading...');
        return false;
    }

    return false;
}

async function waitForLogin(maxWaitMs: number = 5 * 60 * 1000, pollIntervalMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    console.log('[XHS-Post] Waiting for user login...');

    while (Date.now() - startTime < maxWaitMs) {
        if (await isLoggedIn()) {
            console.log('[XHS-Post] User is logged in!');
            return true;
        }
        await sleep(pollIntervalMs);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (elapsed % 30 === 0) {
            console.log(`[XHS-Post] Still waiting for login... ${elapsed}s elapsed`);
        }
    }

    console.log('[XHS-Post] Login wait timed out');
    return false;
}

// ============================================================================
// Image upload strategies
// ============================================================================

/**
 * Strategy 1: Use Playwright's native setInputFiles through the Bridge.
 * Generates a temp image via Canvas in the browser, saves to disk in the
 * bridge process, then uses Playwright's setInputFiles for reliable upload.
 */
async function uploadImageViaPlaywright(text: string): Promise<boolean> {
    try {
        console.log('[XHS-Post] Trying image upload via Playwright setInputFiles...');

        // Call the bridge's uploadFile method which handles generation + upload
        const page = await browserService.getPage();
        if (!page) return false;

        // Use evaluate to call the bridge's uploadFile via a special method
        // Since we can't directly call bridge methods from here, use uploadFile on browserService
        await browserService.uploadFile({
            selector: 'input[type="file"]',
            filePath: '', // Will be ignored in favor of generated image
            instruction: `Generate and upload image with text: ${text}`,
        });

        return true;
    } catch (e) {
        console.log(`[XHS-Post] Playwright upload failed: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}

/**
 * Strategy 2: Canvas + DataTransfer file upload via executeScript.
 * Generates an image in the browser using Canvas API, then programmatically
 * sets it on the file input using DataTransfer API.
 */
async function uploadImageViaCanvas(text: string): Promise<boolean> {
    const safeText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    const result = await execScript(`(async () => {
        try {
            // Create canvas image
            const canvas = document.createElement('canvas');
            canvas.width = 1080;
            canvas.height = 1080;
            const ctx = canvas.getContext('2d');

            // Gradient background
            const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
            grad.addColorStop(0, '#ffecd2');
            grad.addColorStop(1, '#fcb69f');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1080, 1080);

            // Border
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 20;
            ctx.strokeRect(40, 40, 1000, 1000);

            // Text
            ctx.font = 'bold 64px "Microsoft YaHei", "PingFang SC", sans-serif';
            ctx.fillStyle = '#333';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('${safeText}'.substring(0, 20), 540, 540);

            // Convert to blob
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            if (!blob) return 'ERROR: canvas.toBlob failed';

            const file = new File([blob], 'post-image.png', { type: 'image/png' });

            // Find file inputs
            const fileInputs = document.querySelectorAll('input[type="file"]');
            if (fileInputs.length === 0) return 'ERROR: no-file-input';

            // Set via DataTransfer (Chrome 62+)
            const dt = new DataTransfer();
            dt.items.add(file);

            let uploaded = 0;
            for (const fi of fileInputs) {
                try {
                    fi.files = dt.files;
                    fi.dispatchEvent(new Event('change', { bubbles: true }));
                    fi.dispatchEvent(new Event('input', { bubbles: true }));
                    uploaded++;
                } catch (e) { /* skip */ }
            }

            return uploaded > 0 ? 'uploaded-' + uploaded : 'ERROR: dispatchEvent failed';
        } catch (e) {
            return 'ERROR: ' + e.message;
        }
    })()`);

    console.log(`[XHS-Post] Canvas+DataTransfer upload result: ${result}`);
    return result.includes('uploaded');
}

/**
 * Strategy 3: Use "文字配图" (text-to-image) feature.
 * Type text into the tiptap editor, click "生成图片".
 */
async function uploadImageViaTextToImage(text: string): Promise<boolean> {
    const safeText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

    // Click "文字配图"
    const clickResult = await clickByText('文字配图');
    console.log(`[XHS-Post] Click 文字配图: ${clickResult}`);
    if (clickResult.includes('ERROR')) return false;

    await sleep(2000);

    // Type into the tiptap contenteditable on the main page
    const typeResult = await execScript(`(() => {
        // Find the tiptap editor (contenteditable div)
        const editors = document.querySelectorAll('[contenteditable="true"]');
        for (const ed of editors) {
            if (ed.offsetParent === null) continue;
            const cls = (ed.className || '').toLowerCase();
            if (cls.includes('tiptap') || cls.includes('prosemirror') || cls.includes('editor') ||
                ed.getBoundingClientRect().height > 40) {
                // Focus and clear
                ed.focus();
                ed.innerHTML = '';

                // Use execCommand for tiptap/ProseMirror compatibility
                document.execCommand('insertText', false, '${safeText}');

                // Fallback: if execCommand didn't work, set innerHTML
                if (!ed.textContent || ed.textContent.trim().length === 0) {
                    ed.innerHTML = '<p>${safeText}</p>';
                    ed.dispatchEvent(new Event('input', { bubbles: true }));
                }

                return 'typed: ' + ed.tagName + '.' + cls.substring(0, 30) + ' content=' + ed.textContent.substring(0, 30);
            }
        }
        return 'ERROR: no tiptap editor found';
    })()`);
    console.log(`[XHS-Post] Type into tiptap: ${typeResult}`);
    if (typeResult.includes('ERROR')) return false;

    await sleep(1000);

    // Click "生成图片" (search ALL elements, not just buttons)
    const genResult = await clickByText('生成图片');
    console.log(`[XHS-Post] Click 生成图片: ${genResult}`);
    if (genResult.includes('ERROR')) return false;

    // Wait for image generation (up to 15 seconds)
    console.log('[XHS-Post] Waiting for image generation...');
    for (let i = 0; i < 15; i++) {
        await sleep(1000);
        const text = await getPageText();
        // After generation, look for indicators that the post editor appeared
        if (text.includes('标题') || text.includes('添加标题') || text.includes('发布')) {
            console.log(`[XHS-Post] Image generated, editor appeared (${i + 1}s)`);
            return true;
        }
        // Check if there's an error
        if (text.includes('生成失败') || text.includes('生成错误')) {
            console.log('[XHS-Post] Image generation failed');
            return false;
        }
    }

    // Even if we didn't detect keywords, the generation might have succeeded
    console.log('[XHS-Post] Image generation timeout, checking page state...');
    return true; // Optimistic - let the title fill step detect issues
}

// ============================================================================
// Post editor interaction
// ============================================================================

/**
 * Wait for the post editor to appear (title input + content editor).
 * This happens after an image is successfully uploaded.
 */
async function waitForPostEditor(maxWaitMs: number = 20000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const check = await execScript(`(() => {
            // Look for title-like inputs or contenteditables
            const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
            for (const inp of inputs) {
                if (inp.offsetParent === null || inp.type === 'file' || inp.type === 'hidden') continue;
                const ph = (inp.placeholder || '').toLowerCase();
                if (ph.includes('标题') || ph.includes('title')) return 'title-input-found';
            }
            const editors = document.querySelectorAll('[contenteditable="true"]');
            for (const ed of editors) {
                if (ed.offsetParent === null) continue;
                const ph = (ed.getAttribute('data-placeholder') || '').toLowerCase();
                if (ph.includes('标题') || ph.includes('title')) return 'title-editor-found';
            }
            // Also check for "发布" button-like element
            const all = document.querySelectorAll('*');
            for (const el of all) {
                if (el.children.length > 0) continue;
                if (el.offsetParent === null) continue;
                if ((el.textContent || '').trim() === '发布') return 'publish-found';
            }
            return 'waiting';
        })()`);

        if (check !== 'waiting') {
            console.log(`[XHS-Post] Post editor detected: ${check}`);
            return true;
        }
        await sleep(1000);
    }
    console.log('[XHS-Post] Post editor did not appear within timeout');
    return false;
}

/**
 * Fill the title field. Tries multiple strategies:
 * 1. Input with placeholder containing "标题"
 * 2. Contenteditable with data-placeholder containing "标题"
 * 3. First visible text input
 */
async function fillTitle(title: string): Promise<string> {
    const safeTitle = title.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    return execScript(`(() => {
        const title = '${safeTitle}';

        // Strategy 1: Input with title placeholder
        const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (const inp of inputs) {
            if (inp.offsetParent === null || inp.type === 'file' || inp.type === 'hidden') continue;
            const ph = (inp.placeholder || '').toLowerCase();
            const cls = (inp.className || '').toLowerCase();
            if (ph.includes('标题') || ph.includes('title') || cls.includes('title')) {
                inp.focus();
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, title);
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                return 'filled-input: ph=' + inp.placeholder;
            }
        }

        // Strategy 2: Contenteditable with title placeholder
        const editors = document.querySelectorAll('[contenteditable="true"]');
        for (const ed of editors) {
            if (ed.offsetParent === null) continue;
            const ph = (ed.getAttribute('data-placeholder') || '').toLowerCase();
            const cls = (ed.className || '').toLowerCase();
            if (ph.includes('标题') || ph.includes('title') || cls.includes('title')) {
                ed.focus();
                ed.innerHTML = '';
                document.execCommand('insertText', false, title);
                if (!ed.textContent || ed.textContent.trim().length === 0) {
                    ed.innerHTML = title;
                    ed.dispatchEvent(new Event('input', { bubbles: true }));
                }
                return 'filled-editor: ph=' + ed.getAttribute('data-placeholder');
            }
        }

        // Strategy 3: First visible short input (likely title)
        for (const inp of inputs) {
            if (inp.offsetParent === null || inp.type === 'file' || inp.type === 'hidden' || inp.type === 'search') continue;
            inp.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(inp, title);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return 'filled-first-input: ph=' + (inp.placeholder || 'none');
        }

        return 'ERROR: no title field found';
    })()`);
}

/**
 * Fill the content/description field.
 * Looks for contenteditable elements that are NOT the title.
 */
async function fillContent(content: string): Promise<string> {
    const safeContent = content.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    return execScript(`(() => {
        const content = '${safeContent}';

        // Find content editor (contenteditable, not title)
        const editors = document.querySelectorAll('[contenteditable="true"]');
        for (const ed of editors) {
            if (ed.offsetParent === null) continue;
            const ph = (ed.getAttribute('data-placeholder') || '').toLowerCase();
            const cls = (ed.className || '').toLowerCase();

            // Skip title editors
            if (cls.includes('title') || ph.includes('标题') || ph.includes('title')) continue;

            // Content editor indicators
            const isContent = ph.includes('内容') || ph.includes('content') || ph.includes('正文') ||
                              ph.includes('描述') || ph.includes('输入') || ph.includes('说点什么') ||
                              cls.includes('content') || cls.includes('body') || cls.includes('editor') ||
                              cls.includes('desc') || ed.getBoundingClientRect().height > 80;

            if (isContent) {
                ed.focus();
                // Use execCommand for framework compatibility
                const existing = ed.textContent || '';
                if (existing.trim().length === 0) {
                    document.execCommand('insertText', false, content);
                    // Fallback
                    if (!ed.textContent || ed.textContent.trim().length === 0) {
                        ed.innerHTML = '<p>' + content + '</p>';
                        ed.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } else {
                    // Append to existing content
                    document.execCommand('insertText', false, '\\n' + content);
                }
                return 'filled-editor: cls=' + cls.substring(0, 30) + ' h=' + Math.round(ed.getBoundingClientRect().height);
            }
        }

        // Try textarea
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
            if (ta.offsetParent === null) continue;
            ta.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, content);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            return 'filled-textarea';
        }

        // Last resort: any unfilled contenteditable
        for (const ed of editors) {
            if (ed.offsetParent === null) continue;
            if (ed.textContent && ed.textContent.trim().length > 0) continue;
            ed.focus();
            ed.innerHTML = '<p>' + content + '</p>';
            ed.dispatchEvent(new Event('input', { bubbles: true }));
            return 'filled-remaining-editor';
        }

        return 'ERROR: no content field found';
    })()`);
}

/**
 * Click the "发布" (publish) submit button.
 *
 * Key insight: XHS has "发布笔记" in BOTH the sidebar nav and the editor's
 * submit area.  We must skip the sidebar and pick the actual submit button.
 *
 * Strategy:
 *  1. Exclude elements in the left sidebar (rect.left < 200  OR  ancestor has
 *     sidebar/nav/menu class).
 *  2. Prefer real <button> / [role=button] elements.
 *  3. Prefer elements lower on the page (submit buttons sit at the bottom).
 *  4. Fallback: use Playwright click via bridge for more realistic event.
 */
async function clickPublish(): Promise<{ clicked: boolean; message: string }> {
    // Scroll the page down first to ensure the submit button is visible
    await execScript(`(() => {
        // Try to scroll the main editor container
        const containers = document.querySelectorAll('[class*="content"], [class*="editor"], [class*="publish"], main, .main');
        for (const c of containers) {
            if (c.scrollHeight > c.clientHeight + 50) {
                c.scrollTo(0, c.scrollHeight);
            }
        }
        window.scrollTo(0, document.body.scrollHeight);
    })()`);
    await sleep(1000);

    const result = await execScript(`(() => {
        const targets = ['发布笔记', '发布'];
        const all = document.querySelectorAll('*');
        const candidates = [];

        for (const el of all) {
            const txt = (el.textContent || '').trim();
            if (!targets.includes(txt)) continue;
            if (el.offsetParent === null && el.style.display !== 'contents') continue;

            const rect = el.getBoundingClientRect();

            // ── Sidebar exclusion ───────────────────────────────────────
            // Sidebar is on the left side (typically x < 200px)
            if (rect.right < 250 && rect.left < 200) continue;

            // Also check parent chain for sidebar/nav indicators
            let isInNav = false;
            let p = el.parentElement;
            for (let depth = 0; depth < 12 && p; depth++) {
                const pc = (p.className || '').toLowerCase();
                if (pc.includes('sidebar') || pc.includes('side-bar') ||
                    pc.includes('nav') || pc.includes('menu') ||
                    pc.includes('aside') || pc.includes('left-panel') ||
                    p.tagName === 'NAV' || p.tagName === 'ASIDE') {
                    isInNav = true;
                    break;
                }
                // Also: the sidebar on XHS has class "publish-video" on its link
                if (pc.includes('channel') || pc.includes('creator-tab')) {
                    isInNav = true;
                    break;
                }
                p = p.parentElement;
            }
            if (isInNav) continue;

            // ── Leaf / small container check ────────────────────────────
            const isLeaf = el.children.length === 0;
            const isSmall = el.children.length <= 3 && txt.length <= 6;
            if (!isLeaf && !isSmall) continue;

            // ── Properties ──────────────────────────────────────────────
            const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
            const clsLower = (el.className || '').toLowerCase();
            const hasButtonClass = /btn|button|submit|publishbtn|el-button|primary/.test(clsLower);
            const isDisabled = el.hasAttribute('disabled') ||
                el.classList.contains('disabled') ||
                el.getAttribute('aria-disabled') === 'true' ||
                (el.style && el.style.pointerEvents === 'none');

            // ── Scoring ─────────────────────────────────────────────────
            let score = 0;
            if (isButton)       score += 200;  // Real button element: strong signal
            if (hasButtonClass)  score += 100;  // Has btn/button/submit class
            if (!isDisabled)     score += 80;
            if (rect.left >= 200) score += 40;  // Right side of page
            if (rect.top > 300)   score += 20;  // Lower on page
            if (rect.width >= 60 && rect.height >= 28) score += 15; // Reasonable button size
            // Exact text "发布笔记" is more specific
            if (txt === '发布笔记') score += 5;

            candidates.push({
                el, txt, score,
                tag: el.tagName,
                cls: (el.className || '').substring(0, 60),
                isLeaf, isButton, hasButtonClass, isDisabled,
                pos: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
            });
        }

        if (candidates.length === 0) {
            // Collect debug info - all visible leaf texts
            const allTexts = [];
            for (const el of all) {
                if (el.children.length > 0) continue;
                if (el.offsetParent === null) continue;
                const t = (el.textContent || '').trim();
                if (t.length > 0 && t.length <= 15) allTexts.push(t);
            }
            return JSON.stringify({
                clicked: false,
                message: 'No publish button found (sidebar items excluded)',
                visibleLeafTexts: [...new Set(allTexts)].slice(0, 60),
            });
        }

        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);

        // Log all candidates for debugging
        const debugInfo = candidates.map(c => ({
            tag: c.tag, cls: c.cls, txt: c.txt, score: c.score,
            pos: c.pos, disabled: c.isDisabled, isButton: c.isButton,
        }));

        const best = candidates[0];
        if (best.isDisabled) {
            return JSON.stringify({
                clicked: false,
                disabled: true,
                message: 'Publish button is disabled',
                tag: best.tag + '.' + best.cls,
                pos: best.pos,
                allCandidates: debugInfo,
            });
        }

        // Click with full event sequence (Vue/React compatible)
        best.el.scrollIntoView({ behavior: 'instant', block: 'center' });
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev => {
            best.el.dispatchEvent(new PointerEvent(ev, { bubbles: true, cancelable: true, view: window }));
        });
        // Also try .click() directly
        if (typeof best.el.click === 'function') best.el.click();

        return JSON.stringify({
            clicked: true,
            tag: best.tag + '.' + best.cls,
            text: best.txt,
            score: best.score,
            pos: best.pos,
            candidates: candidates.length,
            allCandidates: debugInfo,
        });
    })()`);

    try {
        return JSON.parse(result);
    } catch {
        return { clicked: false, message: result };
    }
}

/**
 * Fallback: use Playwright bridge to click the publish button via real mouse
 * event (more realistic than dispatchEvent).
 *
 * Tries several selectors commonly used on XHS creator platform.
 */
async function tryPlaywrightClickPublish(): Promise<string> {
    try {
        const page = await browserService.getPage();
        if (!page) return 'ERROR: no page';

        // Locate the publish button using various selectors
        const selectors = [
            // Community best practice: button containing "发布"
            'button:has-text("发布笔记")',
            'button:has-text("发布")',
            // XHS-specific classes
            '[class*="publishBtn"]',
            '[class*="submit"]',
            '[class*="el-button--primary"]:has-text("发布")',
            // Generic
            '[data-testid*="publish"]',
        ];

        for (const sel of selectors) {
            try {
                const loc = page.locator(sel).first();
                const visible = await loc.isVisible({ timeout: 2000 }).catch(() => false);
                if (visible) {
                    await loc.scrollIntoViewIfNeeded();
                    await loc.click({ timeout: 5000 });
                    return `clicked via Playwright: ${sel}`;
                }
            } catch {
                // Try next selector
            }
        }

        // Last resort: find by XPath (community pattern)
        try {
            const xpathLoc = page.locator('xpath=//button[contains(text(),"发布")]').first();
            const vis = await xpathLoc.isVisible({ timeout: 2000 }).catch(() => false);
            if (vis) {
                await xpathLoc.click({ timeout: 5000 });
                return 'clicked via Playwright XPath: //button[contains(text(),"发布")]';
            }
        } catch {}

        // Also try: find by CSS position (right side, bottom area)
        try {
            const posResult = await page.evaluate(() => {
                const all = document.querySelectorAll('*');
                for (const el of all) {
                    const txt = (el.textContent || '').trim();
                    if (txt !== '发布笔记' && txt !== '发布') continue;
                    if (el.children.length > 3) continue;
                    const rect = el.getBoundingClientRect();
                    // Must be on the right side (not sidebar)
                    if (rect.left < 200) continue;
                    // Return coordinates for Playwright click
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: el.tagName, cls: (el.className || '').substring(0, 40) };
                }
                return null;
            });
            if (posResult) {
                await page.mouse.click(posResult.x, posResult.y);
                return `clicked via Playwright mouse at (${posResult.x}, ${posResult.y}): ${posResult.tag}.${posResult.cls}`;
            }
        } catch (e) {
            return `ERROR: Playwright click failed: ${e instanceof Error ? e.message : String(e)}`;
        }

        return 'ERROR: no publish button found via Playwright';
    } catch (e) {
        return `ERROR: Playwright fallback failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}

// ============================================================================
// Main posting flow
// ============================================================================

async function executePostingFlow(title: string, content: string): Promise<{
    success: boolean;
    message: string;
    steps: Array<{ step: string; result: string; success: boolean }>;
}> {
    const steps: Array<{ step: string; result: string; success: boolean }> = [];

    // ── Step 1: Ensure browser is connected ──────────────────────────
    try {
        const page = await browserService.getPage();
        if (!page) throw new Error('No page');
        steps.push({ step: 'browser_check', result: 'Browser connected', success: true });
    } catch {
        try {
            await browserService.connect({});
            steps.push({ step: 'browser_connect', result: 'Connected to browser', success: true });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            steps.push({ step: 'browser_connect', result: msg, success: false });
            return { success: false, message: `Failed to connect to browser: ${msg}`, steps };
        }
    }

    // ── Step 2: Navigate to publish page ─────────────────────────────
    try {
        await browserService.navigate(PUBLISH_URL);
        await sleep(3000);
        steps.push({ step: 'navigate', result: `Navigated to ${PUBLISH_URL}`, success: true });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push({ step: 'navigate', result: msg, success: false });
        return { success: false, message: `Failed to navigate: ${msg}`, steps };
    }

    // ── Step 3: Check login status ───────────────────────────────────
    let loggedIn = await isLoggedIn();
    if (!loggedIn) {
        steps.push({ step: 'login_check', result: 'Not logged in, waiting...', success: true });
        console.log('[XHS-Post] Login required. Please login in the browser window...');
        loggedIn = await waitForLogin(5 * 60 * 1000, 5000);
        if (!loggedIn) {
            steps.push({ step: 'login_timeout', result: 'Login timed out', success: false });
            return { success: false, message: 'Login timed out. Please login and try again.', steps };
        }
        steps.push({ step: 'login_confirmed', result: 'Logged in', success: true });
    } else {
        steps.push({ step: 'login_check', result: 'Already logged in', success: true });
    }

    // Re-navigate if needed (login might have changed page)
    const url1 = await getCurrentUrl();
    if (!url1.includes('creator.xiaohongshu.com/publish')) {
        await browserService.navigate(PUBLISH_URL);
        await sleep(3000);
    }

    // ── Step 4: Initial page diagnosis ───────────────────────────────
    const diag1 = await diagnosePage();
    steps.push({ step: 'page_diagnosis', result: diag1.substring(0, 300), success: true });

    // ── Step 5: Click "上传图文" tab ─────────────────────────────────
    const tabResult = await clickByText('上传图文');
    steps.push({ step: 'click_image_tab', result: tabResult, success: !tabResult.includes('ERROR') });
    await sleep(2000);

    // ── Step 6: Upload image (required by XHS before editor appears) ─
    let imageUploaded = false;

    // Strategy A: Canvas + DataTransfer (no bridge changes needed)
    if (!imageUploaded) {
        console.log('[XHS-Post] Trying Canvas + DataTransfer image upload...');
        imageUploaded = await uploadImageViaCanvas(title);
        if (imageUploaded) {
            await sleep(3000);
            // Verify that something changed (editor appeared or image thumbnail visible)
            const afterUpload = await getPageText();
            if (afterUpload.includes('标题') || afterUpload.includes('添加标题') || afterUpload.includes('发布')) {
                steps.push({ step: 'image_upload', result: 'Canvas+DataTransfer upload succeeded', success: true });
            } else {
                console.log('[XHS-Post] Canvas upload may not have triggered XHS handler');
                imageUploaded = false;
            }
        }
        if (!imageUploaded) {
            steps.push({ step: 'image_upload_canvas', result: 'Canvas+DataTransfer did not work', success: false });
        }
    }

    // Strategy B: Playwright native setInputFiles via bridge
    if (!imageUploaded) {
        console.log('[XHS-Post] Trying Playwright setInputFiles...');
        try {
            // Use the bridge's uploadFile with image generation
            const page = await browserService.getPage();
            if (page && typeof page.evaluate === 'function') {
                // Generate image base64 in browser, then pass to bridge for upload
                const base64 = await page.evaluate(({ text }: { text: string }) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 1080;
                    canvas.height = 1080;
                    const ctx = canvas.getContext('2d')!;
                    const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
                    grad.addColorStop(0, '#ffecd2');
                    grad.addColorStop(1, '#fcb69f');
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, 0, 1080, 1080);
                    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                    ctx.lineWidth = 20;
                    ctx.strokeRect(40, 40, 1000, 1000);
                    ctx.font = 'bold 64px sans-serif';
                    ctx.fillStyle = '#333';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text.substring(0, 20), 540, 540);
                    return canvas.toDataURL('image/png').split(',')[1];
                }, { text: title });

                if (base64) {
                    // Write to temp file via sidecar fs
                    const os = await import('os');
                    const fs = await import('fs');
                    const path = await import('path');
                    const tmpPath = path.join(os.tmpdir(), `xhs_post_${Date.now()}.png`);
                    fs.writeFileSync(tmpPath, Buffer.from(base64 as string, 'base64'));
                    console.log(`[XHS-Post] Generated temp image: ${tmpPath}`);

                    // Upload via browserService.uploadFile
                    await browserService.uploadFile({
                        selector: 'input[type="file"]',
                        filePath: tmpPath,
                    });

                    await sleep(3000);
                    const afterUpload = await getPageText();
                    if (afterUpload.includes('标题') || afterUpload.includes('发布')) {
                        imageUploaded = true;
                        steps.push({ step: 'image_upload', result: 'Playwright setInputFiles succeeded', success: true });
                    }

                    // Cleanup temp file
                    try { fs.unlinkSync(tmpPath); } catch {}
                }
            }
        } catch (e) {
            console.log(`[XHS-Post] Playwright setInputFiles failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!imageUploaded) {
            steps.push({ step: 'image_upload_playwright', result: 'Playwright setInputFiles did not work', success: false });
        }
    }

    // Strategy C: "文字配图" text-to-image feature
    if (!imageUploaded) {
        console.log('[XHS-Post] Trying 文字配图 (text-to-image)...');
        imageUploaded = await uploadImageViaTextToImage(content);
        steps.push({
            step: 'image_upload_text2img',
            result: imageUploaded ? '文字配图 succeeded' : '文字配图 failed',
            success: imageUploaded,
        });
    }

    if (!imageUploaded) {
        const diag = await diagnosePage();
        steps.push({ step: 'image_upload_final', result: 'All image upload strategies failed. Diag: ' + diag.substring(0, 200), success: false });
        // Don't return yet — try to continue anyway (the editor might still be available)
    }

    // ── Step 7: Wait for post editor ─────────────────────────────────
    const editorReady = await waitForPostEditor(15000);
    steps.push({ step: 'wait_editor', result: editorReady ? 'Editor ready' : 'Editor not found (continuing anyway)', success: editorReady });

    // ── Step 8: Diagnose before filling ──────────────────────────────
    const diag2 = await diagnosePage();
    steps.push({ step: 'pre_fill_diagnosis', result: diag2.substring(0, 300), success: true });

    // ── Step 9: Fill title ───────────────────────────────────────────
    const titleResult = await fillTitle(title);
    console.log(`[XHS-Post] Fill title: ${titleResult}`);
    steps.push({ step: 'fill_title', result: titleResult, success: !titleResult.includes('ERROR') });

    // ── Step 10: Fill content ────────────────────────────────────────
    const contentResult = await fillContent(content);
    console.log(`[XHS-Post] Fill content: ${contentResult}`);
    steps.push({ step: 'fill_content', result: contentResult, success: !contentResult.includes('ERROR') });

    await sleep(2000);

    // ── Step 11: Pre-publish diagnosis ───────────────────────────────
    const diag3 = await diagnosePage();
    steps.push({ step: 'pre_publish_diagnosis', result: diag3.substring(0, 300), success: true });

    // ── Step 12: Click publish ───────────────────────────────────────
    const publishResult = await clickPublish();
    console.log(`[XHS-Post] Publish: ${JSON.stringify(publishResult)}`);
    steps.push({
        step: 'click_publish',
        result: JSON.stringify(publishResult).substring(0, 300),
        success: publishResult.clicked,
    });

    if (!publishResult.clicked) {
        if ((publishResult as any).disabled) {
            return {
                success: false,
                message: `Publish button is disabled. ${publishResult.message}`,
                steps,
            };
        }

        // If event-dispatch didn't find the button, try Playwright bridge click
        console.log('[XHS-Post] Event dispatch did not find button, trying Playwright click...');
        const pwClick = await tryPlaywrightClickPublish();
        steps.push({
            step: 'click_publish_playwright',
            result: pwClick,
            success: !pwClick.includes('ERROR'),
        });

        if (pwClick.includes('ERROR')) {
            return {
                success: false,
                message: `Could not find publish button. ${publishResult.message}. PW: ${pwClick}`,
                steps,
            };
        }
    }

    // ── Step 13: Wait and verify success ─────────────────────────────
    // After clicking, XHS may show a confirmation dialog, redirect, or
    // show "发布成功". We poll for up to 20 seconds.
    console.log('[XHS-Post] Waiting for publish result...');
    let verified = false;
    let verifyUrl = '';
    let verifyText = '';

    for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(2000);
        verifyUrl = await getCurrentUrl();
        verifyText = await getPageText();

        // Explicit success indicators
        if (verifyUrl.includes('publish/success') ||
            verifyText.includes('发布成功') ||
            verifyText.includes('已发布') ||
            verifyText.includes('笔记发布成功') ||
            verifyText.includes('审核中')) {
            verified = true;
            console.log(`[XHS-Post] Publish verified (attempt ${attempt + 1}): url=${verifyUrl}`);
            break;
        }

        // URL changed to a legitimate page (not about:blank, not the same publish editor)
        if (verifyUrl &&
            verifyUrl !== 'about:blank' &&
            !verifyUrl.includes('publish/publish') &&
            verifyUrl.includes('xiaohongshu.com')) {
            verified = true;
            console.log(`[XHS-Post] URL changed to: ${verifyUrl} (attempt ${attempt + 1})`);
            break;
        }

        // Check if a confirmation dialog appeared (XHS sometimes shows one)
        const hasDialog = await execScript(`(() => {
            // Look for modal/dialog/overlay
            const modals = document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="confirm"], [role="dialog"]');
            for (const m of modals) {
                if (m.offsetParent !== null || m.style.display !== 'none') {
                    const txt = (m.textContent || '').trim().substring(0, 100);
                    if (txt.length > 0) return 'dialog: ' + txt;
                }
            }
            return 'no-dialog';
        })()`);
        if (hasDialog !== 'no-dialog') {
            console.log(`[XHS-Post] Dialog detected: ${hasDialog}`);
            // Try to click confirm/OK in the dialog
            const confirmResult = await execScript(`(() => {
                const btns = document.querySelectorAll('[class*="modal"] button, [class*="dialog"] button, [role="dialog"] button, [class*="confirm"] button');
                for (const b of btns) {
                    const t = (b.textContent || '').trim();
                    if (t === '确认' || t === '确定' || t === 'OK' || t === '发布') {
                        b.click();
                        return 'confirmed: ' + t;
                    }
                }
                return 'no-confirm-btn';
            })()`);
            console.log(`[XHS-Post] Dialog confirm: ${confirmResult}`);
        }

        // Still on publish page = button click might not have worked
        if (verifyUrl.includes('publish/publish') && attempt >= 3) {
            console.log(`[XHS-Post] Still on publish page after ${attempt + 1} attempts, page text snippet: ${verifyText.substring(0, 200)}`);
        }

        // about:blank is NOT a success - likely an error
        if (verifyUrl === 'about:blank') {
            console.log('[XHS-Post] Page went to about:blank - likely navigation error, not success');
        }
    }

    steps.push({
        step: 'verify_publish',
        result: `url=${verifyUrl}, text_snippet=${verifyText.substring(0, 100)}, verified=${verified}`,
        success: verified,
    });

    if (!verified) {
        // Final diagnosis
        const finalDiag = await diagnosePage();
        steps.push({ step: 'final_diagnosis', result: finalDiag.substring(0, 300), success: false });
    }

    return {
        success: verified,
        message: verified
            ? `Post published! Title: "${title}"`
            : `Clicked publish but could not verify success. URL: ${verifyUrl}`,
        steps,
    };
}

// ============================================================================
// Tool definition
// ============================================================================

export const xiaohongshuPostTool: ToolDefinition = {
    name: 'xiaohongshu_post',
    description: `Post content to Xiaohongshu (小红书). Handles the complete workflow:
1. Connects to Chrome (user's profile with login cookies)
2. Navigates to the creator publish page
3. Waits for login if needed
4. Uploads/generates an image (required by XHS)
5. Fills title and content
6. Clicks publish and verifies success

Use this tool when asked to post on Xiaohongshu. Provide title and content.`,
    effects: ['ui:notify', 'network:outbound', 'process:spawn'],
    input_schema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Post title (max ~20 characters for XHS)',
            },
            content: {
                type: 'string',
                description: 'Main body content of the post',
            },
        },
        required: ['title', 'content'],
    },
    handler: async (args: { title: string; content: string }) => {
        const { title, content } = args;

        console.log(`[XHS-Post] Starting posting flow - Title: "${title}", Content: "${content}"`);

        try {
            const result = await executePostingFlow(title, content);

            console.log(`[XHS-Post] Posting flow completed - success: ${result.success}`);
            for (const step of result.steps) {
                console.log(`[XHS-Post]   ${step.step}: ${step.success ? 'OK' : 'FAIL'} - ${step.result.substring(0, 120)}`);
            }

            return result;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[XHS-Post] Fatal error: ${msg}`);
            return {
                success: false,
                message: `Fatal error during posting: ${msg}`,
                steps: [{ step: 'fatal', result: msg, success: false }],
            };
        }
    },
};
