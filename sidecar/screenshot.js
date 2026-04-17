import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('https://example.com', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: 'example-screenshot.png', fullPage: true });
  console.log('截图已保存到 example-screenshot.png');
  await browser.close();
})();
