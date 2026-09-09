const { chromium } = require('playwright');
const path = require('path');

async function testZoom() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['camera', 'microphone'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    const url = 'https://zoom.us/wc/join/74119471350?prefer=1&pwd=3liMl7BgLltOHntYXCFnYWok8EacJb.1';
    console.log("Navigating to", url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    
    await page.screenshot({ path: 'zoom_test_1.png' });
    console.log("Screenshot saved to zoom_test_1.png");
    
    try {
      await page.click('button:has-text("Accept"), button:has-text("Agree")', { timeout: 3000 });
      console.log("Clicked cookie accept");
      await page.waitForTimeout(2000);
    } catch(e) {}
    
    await page.screenshot({ path: 'zoom_test_2.png' });
    
    const content = await page.content();
    require('fs').writeFileSync('zoom_content.html', content);
    console.log("HTML saved");
  } catch (e) {
    console.error(e);
  } finally {
    await browser.close();
  }
}

testZoom();
