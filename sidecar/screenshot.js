import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new'
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  console.log('正在打开 https://example.com ...');
  await page.goto('https://example.com', { waitUntil: 'networkidle2' });
  
  const screenshotPath = 'example-com-screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`截图已保存到: ${screenshotPath}`);
  
  await browser.close();
})();
