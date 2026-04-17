const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('https://example.com', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: 'example-com-screenshot.png', fullPage: true });
  console.log('Screenshot saved to example-com-screenshot.png');
  await browser.close();
})();
