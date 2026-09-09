const { chromium } = require('playwright');
async function testZoom() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://us04web.zoom.us/j/5420888977?pwd=ejOmvtwbrZXszpk600WEuFcGs3bHdi.1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000); // wait a long time
  const text = await page.evaluate(() => document.body.innerText);
  require('fs').writeFileSync('zoom_innertext.txt', text);
  await page.screenshot({ path: 'zoom_innertext.png' });
  console.log("Done");
  await browser.close();
}
testZoom();
