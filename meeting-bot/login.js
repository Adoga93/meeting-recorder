const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const recordingsDir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsDir)){
      fs.mkdirSync(recordingsDir, { recursive: true });
  }
  const statePath = path.join(recordingsDir, 'state.json');
  const cookiesPath = path.join(recordingsDir, 'cookies.json');
  const tempProfileDir = path.join(__dirname, 'temp_login_profile');
  try {
    fs.rmSync(tempProfileDir, { recursive: true, force: true });
  } catch (e) {}

  console.log(`==================================================`);
  console.log(`🔑 STARTING GOOGLE SIGN-IN SETUP (STATE EXPORTER)`);
  console.log(`💾 Target State File: ${statePath}`);
  console.log(`==================================================`);
  console.log(`🌐 Opening a browser window...`);
  console.log(`👉 Please sign into your Google account in the window.`);
  console.log(`👉 Once you have signed in successfully, CLOSE the browser window.`);
  
  const context = await chromium.launchPersistentContext(tempProfileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto('https://accounts.google.com/');

  console.log(`⏳ Waiting for browser window to be closed...`);
  
  // Auto-save storageState periodically while the browser window is active
  const intervalId = setInterval(async () => {
    try {
      await context.storageState({ path: statePath });
      // Also save cookies legacy file for fallback compatibility
      const cookies = await context.cookies();
      fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
    } catch (e) {
      // Ignore errors when context starts closing
    }
  }, 1000);

  return new Promise((resolve) => {
    let hasExited = false;
    async function saveAndExit() {
      if (hasExited) return;
      hasExited = true;
      clearInterval(intervalId);
      console.log(`\n🎉 Exiting. Extracted authentication state...`);
      
      try {
        await context.storageState({ path: statePath }).catch(() => null);
        console.log(`💾 Saved state to: ${statePath}`);
        const cookies = await context.cookies().catch(() => null);
        if (cookies) {
          fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
        }
      } catch (err) {
        // Fallback to what was already auto-saved in the interval
      }

      await context.close().catch(() => {});
      // Clean up temporary profile dir
      try {
        fs.rmSync(tempProfileDir, { recursive: true, force: true });
      } catch (e) {}
      resolve();
      process.exit(0);
    }

    context.on('close', saveAndExit);
    page.on('close', saveAndExit);
  });
}

main().catch(console.error);
