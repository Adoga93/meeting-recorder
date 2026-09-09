const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configure recording configurations via environment variables
const MEETING_URL = process.env.MEETING_URL || 'https://zoom.us/j/123456789'; 
const BOT_NAME = process.env.BOT_NAME || 'AI Recorder (Emma)';
const MAX_DURATION_MINUTES = parseInt(process.env.MAX_DURATION_MINUTES || '60', 10);

async function runZoomBot() {
  console.log("==================================================");
  console.log(`🤖 STARTING ZOOM MEETING RECORDER BOT`);
  console.log(`🔗 Meeting Link: ${MEETING_URL}`);
  console.log(`🏷️ Bot Display Name: ${BOT_NAME}`);
  console.log("==================================================");

  // Ensure the recordings output directory exists
  const recordingsDir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsDir)){
      fs.mkdirSync(recordingsDir, { recursive: true });
  }

  // Parse Passcode from query params (?pwd=...)
  let passcode = '';
  const pwdMatch = MEETING_URL.match(/[?&]pwd=([^&#]+)/);
  if (pwdMatch && pwdMatch[1]) {
    passcode = pwdMatch[1];
    console.log(`🔑 Extracted passcode parameter`);
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['camera', 'microphone'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90000);

  try {
    console.log(`🌐 Navigating to original Zoom URL: ${MEETING_URL}`);
    await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Bypassing any cookie preferences first so they don't block the UI
    try {
      const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Agree"), button:has-text("ACCEPT COOKIES")').first();
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
        console.log("🍪 Dismissed cookie consent modal");
        await page.waitForTimeout(2000);
      }
    } catch(e) {}

    // Look for "Join from browser" button
    const joinBrowserBtn = page.locator('text="Join from browser", text="Join from Your Browser"').last();
    if (await joinBrowserBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await joinBrowserBtn.click({ force: true });
      console.log("🖱️ Clicked 'Join from browser'");
    } else {
      // Sometimes we need to click "Launch Meeting" first
      const launchBtn = page.locator('text="Launch Meeting"').last();
      if (await launchBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await launchBtn.click({ force: true });
        console.log("🖱️ Clicked 'Launch Meeting'");
        await page.waitForTimeout(3000);
        if (await joinBrowserBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await joinBrowserBtn.click({ force: true });
          console.log("🖱️ Clicked 'Join from browser' after 'Launch Meeting'");
        }
      }
    }
    
    await page.waitForTimeout(5000);
    
    // Check if the link is actually invalid or expired
    const invalidText = page.locator('text="This meeting link is invalid"');
    if (await invalidText.isVisible({ timeout: 2000 }).catch(() => false)) {
      throw new Error("Zoom says: This meeting link is invalid (3,001). The meeting may have ended or the link is wrong.");
    }

    // Enter name input field on the Zoom join page (using generic attributes to bypass dynamic Zoom structures)
    const nameInputSelector = 'input[type="text"], input[name="input-displayname"], input[placeholder="Your Name"], input#inputname, input[aria-label="Your Name"]';
    await page.waitForSelector(nameInputSelector, { timeout: 25000 });
    await page.fill(nameInputSelector, BOT_NAME);
    console.log(`📝 Entered display name: "${BOT_NAME}"`);

    // Check if passcode is requested and fill it
    const passcodeSelector = 'input[type="password"], input[name="input-passcode"], input#inputpasscode, input[placeholder="Meeting Passcode"]';
    if (passcode) {
      try {
        if (await page.locator(passcodeSelector).isVisible({ timeout: 5000 })) {
          await page.fill(passcodeSelector, passcode);
          console.log(`🔑 Filled meeting passcode dynamically.`);
        }
      } catch (e) {
        // Passcode field might not have loaded yet or wasn't needed immediately
      }
    }

    // Click the Join button
    const joinButton = page.getByRole('button', { name: /Join/i })
      .or(page.locator('button.preview-join-button'))
      .or(page.locator('button:has-text("Join")'))
      .or(page.locator('button[type="submit"]'))
      .first();
    await joinButton.click({ force: true });
    console.log("⏳ Clicked Join. Waiting to enter meeting room...");

    // Wait for the meeting view (audio connection button or canvas element is a good indicator)
    await page.waitForSelector('button.join-audio-by-voip, button.join-audio, canvas.video-canvas, button[aria-label*="audio" i], button:has-text("Join Audio")', { timeout: 120000 });
    console.log("🎉 Successfully inside the Zoom meeting room!");

    // Automatically join computer audio if prompted
    try {
      const audioBtn = page.getByRole('button', { name: /Join Audio by Computer/i })
        .or(page.getByRole('button', { name: /Join Audio/i }))
        .or(page.locator('button.join-audio-by-voip'))
        .or(page.locator('button:has-text("Join Audio by Computer")'))
        .first();
      if (await audioBtn.isVisible({ timeout: 10000 })) {
        await audioBtn.click();
        console.log("🔊 Joined Computer Audio successfully.");
      }
    } catch (e) {
      console.log("ℹ️ Could not automatically click Join Audio button: ", e.message);
    }

  } catch (error) {
    console.error("❌ Failed during the Zoom join sequence:", error.message);
    await page.screenshot({ path: path.join(recordingsDir, 'failed_join.png') });
    await browser.close();
    process.exit(1);
  }

  // --- START THE REAL-TIME AUDIO & VIDEO RECORDING ---
  const outputFileName = `zoom_${Date.now()}.mp4`;
  const outputFilePath = path.join(recordingsDir, outputFileName);
  console.log(`📹 Initializing FFmpeg recorder...`);
  console.log(`💾 Saving recording to: ${outputFilePath}`);

  const ffmpegArgs = [
    '-y',
    '-f', 'x11grab',
    '-video_size', '1280x720',
    '-framerate', '30',
    '-i', ':99.0',
    '-f', 'pulse',
    '-ac', '2',
    '-i', 'Virtual_Speaker.monitor',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+frag_keyframe+separate_moof+default_base_moof',
    outputFilePath
  ];

  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', (data) => {
    const log = data.toString();
    if (log.includes('frame=')) {
      process.stdout.write(`\rRecording status: ${log.trim().split('\n').pop()}`);
    }
  });

  console.log("🟢 Recording has started successfully!");

  // --- MONITOR LIFECYCLE ---
  const startTime = Date.now();
  const maxDurationMs = MAX_DURATION_MINUTES * 60 * 1000;
  let keepRecording = true;

  while (keepRecording) {
    await page.waitForTimeout(10000);

    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= maxDurationMs) {
      console.log("\n⚠️ Reached maximum recording duration. Stopping bot.");
      keepRecording = false;
      break;
    }

    // Check if we are still in the meeting
    const leaveButton = page.locator('button.leave-meeting-options__btn, button:has-text("Leave")');
    const isMeetingActive = await leaveButton.isVisible().catch(() => false);
    if (!isMeetingActive) {
      // If leave button isn't visible, check if we've been disconnected or kicked
      const relog = page.locator('button:has-text("Rejoin"), button:has-text("Return to home")');
      if (await relog.isVisible().catch(() => false)) {
        console.log("\n🚪 Disconnected from Zoom meeting.");
        keepRecording = false;
        break;
      }
    }
  }

  // --- GRACEFUL SHUTDOWN ---
  console.log("🧹 Cleaning up and finalizing files...");
  ffmpegProcess.kill('SIGINT');
  await page.waitForTimeout(3000);
  await browser.close();
  console.log("🎉 Zoom Meeting Recorder completed successfully!");
}

module.exports = runZoomBot;
