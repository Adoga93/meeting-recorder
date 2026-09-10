const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configure recording configurations via environment variables (with defaults)
const MEETING_URL = process.env.MEETING_URL || 'https://meet.google.com/abc-defg-hij'; 
const BOT_NAME = process.env.BOT_NAME || 'AI Assistant (Recording)';
const MAX_DURATION_MINUTES = parseInt(process.env.MAX_DURATION_MINUTES || '60', 10);

// Dynamic router imports depending on the platform type
async function runBot() {
  if (MEETING_URL.includes("zoom.us") || MEETING_URL.includes("zoom.com")) {
    console.log("⚡ Route Match: Zoom Video. Redirecting execution to zoom.js runner...");
    // Require and trigger the Zoom runner function
    const runZoomBot = require('./zoom.js');
    await runZoomBot();
    return; 
  }
  
  // -- Otherwise, default to Google Meet automation --
  console.log("==================================================");
  console.log(`🤖 STARTING AI MEETING RECORDER BOT`);
  console.log(`🔗 Meeting Link: ${MEETING_URL}`);
  console.log(`🏷️ Bot Display Name: ${BOT_NAME}`);
  console.log("==================================================");

  // Ensure the recordings output directory exists
  const recordingsDir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsDir)){
      fs.mkdirSync(recordingsDir, { recursive: true });
  }

  // Launch Chromium inside Xvfb
  const browser = await chromium.launch({
    headless: false, // Must be false inside Xvfb to render browser UI and video frames
    args: [
      '--use-fake-ui-for-media-stream',    // Automatically allow camera and mic permissions
      '--use-fake-device-for-media-stream', // Emulate a dummy camera/mic input
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // Bypass Google's basic bot detection by hiding "navigator.webdriver"
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors'
    ]
  });

  const statePath = path.join(recordingsDir, 'state.json');
  const cookiesPath = path.join(recordingsDir, 'cookies.json');
  
  let contextOptions = {
    viewport: { width: 1280, height: 720 },
    permissions: ['camera', 'microphone'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York'
  };

  // Load storageState (cookies + localStorage) if it exists, otherwise fallback to cookies.json
  if (fs.existsSync(statePath)) {
    console.log(`🔑 Found storage state.json at: ${statePath}. Loading authenticated state...`);
    contextOptions.storageState = statePath;
  }

  const context = await browser.newContext(contextOptions);

  if (!fs.existsSync(statePath) && fs.existsSync(cookiesPath)) {
    console.log(`🍪 Found legacy cookies.json at: ${cookiesPath}. Injecting...`);
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      await context.addCookies(cookies);
      console.log(`✅ Injected ${cookies.length} session cookies.`);
    } catch (e) {
      console.error(`❌ Failed to load cookies:`, e.message);
    }
  } else if (!fs.existsSync(statePath) && !fs.existsSync(cookiesPath)) {
    console.log(`ℹ️ No authenticated state or cookies found. Running as unauthenticated guest.`);
  }

  const page = await context.newPage();
  
  // Forward page console events and errors to Node console to capture network/WebRTC errors
  page.on('console', msg => {
    const txt = msg.text();
    // Filter out noisy warnings if needed, but show critical issues
    if (msg.type() === 'error' || txt.includes('WebRTC') || txt.includes('ICE') || txt.includes('connect')) {
      console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${txt}`);
    }
  });
  page.on('pageerror', err => {
    console.error(`[Browser PageError]: ${err.message}`);
  });
  
  // Set generous navigation timeout (90 seconds) to accommodate slower container network startups
  page.setDefaultNavigationTimeout(90000);

  console.log("🌐 Navigating to Google Meet call...");
  try {
    // Wait for DOM content to load instead of the entire heavy SPA resources (prevents 30s timeouts)
    await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000); // Give it a moment to stabilize
    
    // Check if we got redirected to the landing/marketing page instead of the lobby
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    if (currentUrl.includes('/about/') || currentUrl.includes('apps.google.com') || currentUrl.endsWith('meet.google.com/') || currentUrl.endsWith('meet.google.com')) {
      console.log("⚠️ Redirected to landing page! Attempting to force navigation directly to the room...");
      await page.goto(MEETING_URL, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(5000);
    }
  } catch (navError) {
    console.warn("⚠️ Navigation warning (continuing anyway):", navError.message);
  }

  // --- HANDLE ACCOUNT CHOOSER / SIGN-IN WALLS ---
  try {
    let currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.log("📍 Redirected to Google Accounts. Handling sign-in chooser...");
      const chooserHeader = page.locator('text="Choose an account", text="Choose Account"');
      const isChooserVisible = await chooserHeader.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (isChooserVisible) {
        console.log("👥 Account chooser detected.");
        
        // Check if the account is signed out
        const isSignedOut = await page.locator('text="Signed out"').isVisible({ timeout: 2000 }).catch(() => false);
        if (isSignedOut) {
          console.warn("⚠️ Google Account is marked as 'Signed out'. Cookies have expired!");
          console.log("🧼 Clearing expired cookies and falling back to guest mode...");
          await context.clearCookies();
          console.log("🌐 Navigating back to Google Meet room as guest...");
          await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
          await page.waitForTimeout(5000);
        } else {
          console.log("Selecting account...");
          // Find account option by data-email, role or substring text match
          let accountOption = page.locator('[data-email]');
          if (await accountOption.count() === 0) {
            accountOption = page.locator('div[role="link"]:has-text("@")');
          }
          if (await accountOption.count() === 0) {
            accountOption = page.locator('text=@');
          }

          if (await accountOption.count() > 0) {
            const matchedEmail = await accountOption.first().getAttribute('data-email') || 'matching option';
            console.log(`👉 Selecting account: ${matchedEmail}`);
            await accountOption.first().click();
            console.log("✅ Clicked account option. Waiting for authentication to settle...");
            await page.waitForTimeout(5000);
            
            // Force navigation back to the meeting room now that the account is selected
            console.log("🌐 Forcing navigation back to Google Meet call...");
            await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
            await page.waitForTimeout(5000);
          } else {
            console.warn("⚠️ Account chooser was visible, but could not find any account options containing '@' or data-email.");
          }
        }
      } else {
        // Not a chooser page but still on accounts.google.com (e.g. password prompt or login screen)
        console.warn("⚠️ Stuck on Google Sign-in screen. Clearing cookies and falling back to guest mode...");
        await context.clearCookies();
        console.log("🌐 Navigating back to Google Meet room as guest...");
        await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(5000);
      }
    }
  } catch (chooserError) {
    console.warn("⚠️ Exception handling account chooser:", chooserError.message);
  }

  // --- BYPASS COOKIE CONSENT WALLS (For UK/Europe/West Africa regions) ---
  try {
    // Look for standard Google "I agree" or "Accept all" buttons
    const consentButton = page.locator('button:has-text("Accept all"), font:has-text("Accept all"), button:has-text("I agree"), button:has-text("Reject all"), button:has-text("Accept"), [aria-label*="Accept all"]');
    if (await consentButton.isVisible({ timeout: 5000 })) {
      console.log("🍪 Google cookie consent screen detected. Bypassing...");
      await consentButton.click();
      await page.waitForTimeout(3000); // Wait for redirect/page reload
    }
  } catch (e) {
    // No consent screen appeared, continue
  }

  // --- AUTOMATE GOOGLE MEET ENTRY ---
  try {
    // 1. Enter Display Name if prompted (only for anonymous guests)
    const nameInputSelector = 'input[type="text"], input[placeholder="Your name"], input[aria-label="Your name"]';
    try {
      if (await page.locator(nameInputSelector).isVisible({ timeout: 5000 })) {
        await page.fill(nameInputSelector, BOT_NAME);
        console.log(`📝 Entered display name: "${BOT_NAME}"`);
      } else {
        console.log("ℹ️ No display name input field visible. Assuming pre-authenticated Google session.");
      }
    } catch (e) {
      console.log("ℹ️ No display name input field found. Proceeding to join...");
    }

    // Dismiss any tooltips/popups like "Got it"
    try {
      const gotItBtn = page.locator('button:has-text("Got it"), [aria-label*="Got it"], button:has-text("Got It")').first();
      if (await gotItBtn.isVisible({ timeout: 5000 })) {
        await gotItBtn.click();
        console.log("👋 Dismissed 'Got it' onboarding tooltip.");
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // Tooltip didn't show up
    }

    // Ensure microphone and camera are muted before joining
    try {
      console.log("🔇 Ensuring microphone and camera are muted...");
      await page.keyboard.press('Control+d'); // Google Meet hotkey to mute mic
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+e'); // Google Meet hotkey to turn off camera
      await page.waitForTimeout(500);

      const micBtn = page.locator('div[role="button"][aria-label*="turn off microphone" i], button[aria-label*="turn off microphone" i], [aria-label*="microphone" i][data-is-muted="false"]').first();
      if (await micBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await micBtn.click();
        console.log("🔇 Clicked mute microphone button.");
      }
    } catch (muteErr) {}

    // 2. Click "Ask to Join", "Join now", "Join here too", or "Switch here"
    // Use .first() to prevent Playwright strict mode violations
    const joinButton = page.locator(
      'button:has-text("Ask to join"), button:has-text("Join now"), ' +
      'button:has-text("Ask to Join"), button:has-text("Join Now"), ' +
      'button:has-text("Switch here"), button:has-text("Switch Here"), ' +
      'button:has-text("Join here too"), button:has-text("Join Here Too"), ' +
      'button[aria-label*="join" i], button[aria-label*="switch" i]'
    ).first();
    
    await joinButton.waitFor({ state: 'visible', timeout: 20000 });
    const btnText = await joinButton.textContent();
    console.log(`☝️ Clicking join button with text: "${btnText.trim()}"`);
    await joinButton.click({ force: true });
    console.log("⏳ Requested entry. Waiting for host to admit us in the meeting lobby...");

    // 3. Confirm Admission (Wait for the "Leave Call" button to appear)
    const leaveButtonSelector = 'button[aria-label="Leave call"], button[aria-label="Leave meeting"]';
    await page.waitForSelector(leaveButtonSelector, { timeout: 300000 }); // Wait up to 5 minutes
    console.log("🎉 Successfully Admitted to the meeting!");

    // Double check mic is muted inside the call room
    try {
      const inCallMicUnmuted = page.locator('button[aria-label*="turn off microphone" i]').first();
      if (await inCallMicUnmuted.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.keyboard.press('Control+d');
        console.log("🔇 Muted microphone inside meeting room.");
      }
    } catch (e) {}

  } catch (error) {
    console.error("❌ Failed during the join sequence:", error.message);
    // Take a screenshot of the failure for local debugging
    await page.screenshot({ path: path.join(recordingsDir, 'failed_join.png') });
    console.log(`📸 Failure screenshot saved to recordings/failed_join.png`);
    await browser.close();
    process.exit(1);
  }

  // --- START THE REAL-TIME AUDIO & VIDEO RECORDING ---
  const outputFileName = `meeting_${Date.now()}.mp4`;
  const outputFilePath = path.join(recordingsDir, outputFileName);
  console.log(`📹 Initializing FFmpeg recorder...`);
  console.log(`💾 Saving recording to: ${outputFilePath}`);

  // Spawn FFmpeg to capture virtual display (:99) and PulseAudio loopback source (Virtual_Speaker.monitor)
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
    // Print FFmpeg status (keep it clean)
    const log = data.toString();
    if (log.includes('frame=')) {
      process.stdout.write(`\rRecording status: ${log.trim().split('\n').pop()}`);
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`\n📹 FFmpeg recording closed with code ${code}`);
  });

  console.log("🟢 Recording has started successfully!");

  // --- MONITOR MEETING LIFECYCLE ---
  const startTime = Date.now();
  const maxDurationMs = MAX_DURATION_MINUTES * 60 * 1000;
  let keepRecording = true;

  while (keepRecording) {
    await page.waitForTimeout(10000); // Check status every 10 seconds

    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= maxDurationMs) {
      console.log("\n⚠️ Reached maximum recording duration. Stopping bot.");
      keepRecording = false;
      break;
    }

    // 1. Check if the host ended the call or removed the bot
    const endedIndicator = page.locator(
      'text="The host ended the meeting", text="Meeting ended", text="You\'ve been removed", text="You were removed", button:has-text("Return to home screen"), button:has-text("Submit feedback")'
    );
    const hasEnded = await endedIndicator.first().isVisible({ timeout: 1000 }).catch(() => false);
    if (hasEnded) {
      console.log("\n🚪 Meeting end indicator detected (Host ended call / Return to home screen). Leaving now.");
      keepRecording = false;
      break;
    }

    // 2. Check if URL navigated away from the meeting call
    const currentUrl = page.url();
    if (!currentUrl.includes('meet.google.com/')) {
      console.log("\n🚪 Navigated away from meeting room URL. Disconnecting bot.");
      keepRecording = false;
      break;
    }

    // 3. Check if the "Leave call" button is still visible
    const leaveButtonSelector = 'button[aria-label="Leave call"], button[aria-label="Leave meeting"]';
    const isLeaveBtnVisible = await page.locator(leaveButtonSelector).isVisible({ timeout: 1000 }).catch(() => false);
    if (!isLeaveBtnVisible) {
      console.log("\n🚪 Meeting active status: No 'Leave call' button found. Bot disconnected.");
      keepRecording = false;
      break;
    }

    // 4. Check if everyone else has left
    try {
      const alonePrompt = await page.locator('text="You\'re the only one here"').isVisible({ timeout: 1000 }).catch(() => false);
      if (alonePrompt) {
        console.log("\n🚪 'You're the only one here' prompt detected. Leaving now.");
        keepRecording = false;
        break;
      }

      let participantText = await page.locator('div[aria-label="Show everyone"] + span').textContent().catch(() => null);
      if (!participantText) {
        participantText = await page.locator('button[aria-label*="people" i] span, button[aria-label*="participant" i] span').textContent().catch(() => null);
      }
      if (participantText) {
        const count = parseInt(participantText.replace(/\D/g, ''), 10);
        if (!isNaN(count) && count <= 1) {
          console.log(`\n🚪 Everyone else has left the meeting (${count} participant left). Leaving now.`);
          keepRecording = false;
          break;
        }
      }
    } catch (e) {
      // Bypassed if UI layout is slightly different
    }
  }

  // --- GRACEFUL SHUTDOWN ---
  console.log("🧹 Cleaning up and finalizing files...");

  // 1. Terminate FFmpeg gracefully with SIGINT (Critical to write correct MP4 headers!)
  console.log("🛑 Stopping FFmpeg recording...");
  ffmpegProcess.kill('SIGINT');

  // Wait 3 seconds for FFmpeg to finish writing
  await page.waitForTimeout(3000);

  // 2. Click leave call button
  try {
    const leaveButton = page.locator('button[aria-label="Leave call"], button[aria-label="Leave meeting"]');
    if (await leaveButton.isVisible()) {
      await leaveButton.click();
      console.log("👋 Left the meeting call successfully.");
    }
  } catch (err) {}

  await browser.close();

  // 3. Automatically upload recording to Google Drive (if token exists)
  try {
    const uploadScript = path.join(__dirname, 'upload_drive.js');
    if (fs.existsSync(uploadScript)) {
      console.log("☁️ Triggering Google Drive automated upload for:", outputFilePath);
      const { uploadFile } = require('./upload_drive');
      await uploadFile(outputFilePath);
    }
  } catch (driveErr) {
    console.warn("⚠️ Google Drive upload notice:", driveErr.message);
  }

  console.log("🎉 Meeting Recorder completed successfully!");
}

runBot().catch(console.error);
