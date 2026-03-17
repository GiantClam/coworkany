from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('https://example.com')
    page.screenshot(path='example_com_screenshot.png', full_page=True)
    browser.close()
    print("Screenshot saved to example_com_screenshot.png")
