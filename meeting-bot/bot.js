const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configure recording configurations via environment variables (with defaults)
const MEETING_URL = process.env.MEETING_URL || 'https://meet.google.com/abc-defg-hij'; 
const BOT_NAME = process.env.BOT_NAME || 'PAS Tutors Admin';
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

  if (MEETING_URL.includes("teams.microsoft.com") || MEETING_URL.includes("teams.live.com")) {
    console.log("⚡ Route Match: Microsoft Teams. Redirecting execution to teams.js runner...");
    const runTeamsBot = require('./teams.js');
    await runTeamsBot();
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
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timezoneId: 'America/New_York'
  };

  // Load storageState (Google account credentials) if present
  if (fs.existsSync(statePath)) {
    console.log(`🔑 Found storage state.json at: ${statePath}. Loading authenticated Google session...`);
    contextOptions.storageState = statePath;
  } else if (fs.existsSync(cookiesPath)) {
    console.log(`🍪 Found cookies.json at: ${cookiesPath}.`);
  }

  const context = await browser.newContext(contextOptions);

  if (!fs.existsSync(statePath) && fs.existsSync(cookiesPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      await context.addCookies(cookies);
      console.log(`✅ Injected ${cookies.length} session cookies.`);
    } catch (e) {
      console.error(`❌ Failed to load cookies:`, e.message);
    }
  }

  const page = await context.newPage();
  
  // Forward page console events and errors to Node console to capture network/WebRTC errors
  page.on('console', msg => {
    const txt = msg.text();
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
    await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);
    
    // Check if we got redirected away to marketing/account pages
    let currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    if (currentUrl.includes('/about/') || currentUrl.includes('apps.google.com') || currentUrl.includes('workspace.google') || currentUrl.endsWith('meet.google.com/') || currentUrl.endsWith('meet.google.com')) {
      console.log("⚠️ Redirected away from meeting room! Attempting direct room navigation...");
      await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(5000);
    }
  } catch (navError) {
    console.warn("⚠️ Navigation warning (continuing anyway):", navError.message);
  }

  // --- HANDLE ACCOUNT CHOOSER / SIGN-IN WALLS ---
  try {
    let currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.log("📍 Redirected to Google Accounts. Checking session status...");
      const chooserHeader = page.locator('text="Choose an account", text="Choose Account"');
      const isChooserVisible = await chooserHeader.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (isChooserVisible) {
        console.log("👥 Account chooser detected.");
        // Check if account is marked as Signed out
        const isSignedOut = await page.locator('text="Signed out", text="Déconnecté", text="Session expirée"').isVisible({ timeout: 2000 }).catch(() => false);
        if (isSignedOut) {
          console.warn("⚠️ Google Account session has expired on Google servers ('Signed out').");
          console.log("🧼 Falling back to Guest Mode so the class entry proceeds without missing the meeting...");
          await context.clearCookies().catch(() => {});
          await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
          await page.waitForTimeout(5000);
        } else {
          console.log("Selecting Google account...");
          const accountOption = page.locator('div[role="link"]:has-text("@"), div[role="link"]:has-text("PAS Tutor"), [data-email]').first();
          if (await accountOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await accountOption.click();
            await page.waitForTimeout(4000);
            await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
            await page.waitForTimeout(5000);
          }
        }
      } else {
        console.warn("⚠️ Stuck on Google Sign-in screen. Falling back to Guest Mode...");
        await context.clearCookies().catch(() => {});
        await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(5000);
      }
    }
  } catch (chooserError) {
    console.warn("⚠️ Exception handling account chooser:", chooserError.message);
  }

  // --- BYPASS COOKIE CONSENT WALLS (For UK/Europe/West Africa regions) ---
  try {
    const consentButton = page.locator('button:has-text("Accept all"), button:has-text("Tout accepter"), button:has-text("I agree"), button:has-text("J\'accepte"), button:has-text("Reject all"), button:has-text("Accept"), [aria-label*="Accept all" i]').first();
    if (await consentButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("🍪 Google cookie consent screen detected. Bypassing...");
      await consentButton.click({ force: true });
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    // No consent screen appeared, continue
  }

  // --- AUTOMATE GOOGLE MEET ENTRY ---
  try {
    // 1. Check if the meeting hasn't started yet ("You can't join this video call" / "Host must join first")
    const cantJoinSelector = 'text="You can\'t join this video call", text="Vous ne pouvez pas participer", text="No one can join a meeting unless invited", button:has-text("Return to home screen"), button:has-text("Retourner à l\'écran")';
    const hostWaitStartTime = Date.now();
    const MAX_HOST_WAIT_MS = 15 * 60 * 1000; // Wait up to 15 minutes for host to open room

    while (Date.now() - hostWaitStartTime < MAX_HOST_WAIT_MS) {
      const isCantJoin = await page.locator(cantJoinSelector).first().isVisible({ timeout: 2000 }).catch(() => false);
      if (isCantJoin) {
        const elapsedMins = Math.round((Date.now() - hostWaitStartTime) / 1000 / 60);
        console.log(`⏳ Host has not opened the meeting yet ("You can't join this video call"). Waiting for teacher/host to start room (${elapsedMins}/15 mins)...`);
        await page.waitForTimeout(15000);
        console.log("🔄 Checking if meeting room is now open...");
        await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(4000);
        continue;
      }
      break;
    }

    // Dismiss any tooltips/popups like "Got it", "Dismiss", "Close" (e.g. Camera/Mic not found modal)
    try {
      const dismissBtn = page.locator('button:has-text("Close"), button:has-text("Fermer"), button:has-text("Got it"), button:has-text("Got It"), button:has-text("Compris"), button:has-text("Dismiss"), button:has-text("Ignorer")').first();
      if (await dismissBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dismissBtn.click({ force: true });
        console.log("👋 Dismissed lobby dialog modal.");
        await page.waitForTimeout(1000);
      }
    } catch (e) {}

    // 2. Enter Display Name if prompted
    const nameInputSelector = 'input[type="text"], input[placeholder*="name" i], input[aria-label*="name" i], input[placeholder*="nom" i], input[aria-label*="nom" i]';
    try {
      const nameInput = page.locator(nameInputSelector).first();
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill(BOT_NAME);
        console.log(`📝 Entered display name: "${BOT_NAME}"`);
      } else {
        console.log("ℹ️ No display name input field visible. Proceeding to join...");
      }
    } catch (e) {
      console.log("ℹ️ No display name input field found. Proceeding to join...");
    }

    // Ensure microphone and camera are muted before joining
    try {
      console.log("🔇 Ensuring microphone and camera are muted...");
      await page.keyboard.press('Control+d');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+e');
      await page.waitForTimeout(500);

      const micBtn = page.locator('div[role="button"][aria-label*="microphone" i], button[aria-label*="microphone" i]').first();
      if (await micBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const ariaLabel = (await micBtn.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel.includes('turn off') || ariaLabel.includes('désactiver')) {
          await micBtn.click();
          console.log("🔇 Clicked mute microphone button.");
        }
      }
    } catch (muteErr) {}

    // 3. Click "Ask to Join", "Join now", "Join here too", or "Switch here"
    const joinButton = page.locator(
      'button:has-text("Ask to join"), button:has-text("Join now"), ' +
      'button:has-text("Ask to Join"), button:has-text("Join Now"), ' +
      'button:has-text("Demander à participer"), button:has-text("Participer à la réunion"), ' +
      'button:has-text("Demander"), button:has-text("Participer"), ' +
      'button:has-text("Switch here"), button:has-text("Switch Here"), ' +
      'button:has-text("Join here too"), button:has-text("Join Here Too"), ' +
      'button[aria-label*="join" i], button[aria-label*="participer" i], ' +
      'button[aria-label*="switch" i]'
    ).first();
    
    await joinButton.waitFor({ state: 'visible', timeout: 30000 });
    const btnText = await joinButton.textContent();
    console.log(`☝️ Clicking join button with text: "${btnText.trim()}"`);
    await joinButton.click({ force: true });
    console.log("⏳ Requested entry. Waiting for host to admit us in the meeting lobby...");

    // 4. Confirm Admission (Wait up to 15 minutes for host to admit)
    const leaveButtonSelector = 'button[aria-label*="Leave" i], button[aria-label*="Quitter" i], button[data-tooltip*="Leave" i], button[data-tooltip*="Quitter" i], [aria-label*="Leave call" i], [aria-label*="Quitter l\'appel" i]';
    await page.waitForSelector(leaveButtonSelector, { timeout: 900000 });
    console.log("🎉 Successfully Admitted to the meeting!");

    // Double check mic is muted inside the call room
    try {
      const inCallMicUnmuted = page.locator('button[aria-label*="turn off microphone" i], button[aria-label*="désactiver le micro" i]').first();
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
    } else if (log.toLowerCase().includes('error') || log.toLowerCase().includes('cannot') || log.toLowerCase().includes('failed')) {
      console.error(`[FFmpeg Error]: ${log.trim()}`);
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`\n📹 FFmpeg recording closed with code ${code}`);
  });

  console.log("🟢 Recording has started successfully!");

  // --- MONITOR MEETING LIFECYCLE ---
  const startTime = Date.now();
  const maxDurationMs = MAX_DURATION_MINUTES * 60 * 1000;
  const START_GRACE_PERIOD_MS = 15 * 60 * 1000; // 15-minute initial grace period for students/teachers to join
  const REQUIRED_ALONE_CHECKS = 18; // Must be empty for 18 consecutive checks (3 mins) before leaving
  let consecutiveAloneCount = 0;
  let keepRecording = true;

  console.log(`⏱️ Lifecycle Monitor started. 15-minute initial arrival grace period active.`);

  while (keepRecording) {
    await page.waitForTimeout(10000); // Check status every 10 seconds

    const elapsedTime = Date.now() - startTime;
    const elapsedMinutes = (elapsedTime / (60 * 1000)).toFixed(1);
    const isGracePeriod = elapsedTime < START_GRACE_PERIOD_MS;

    if (elapsedTime >= maxDurationMs) {
      console.log(`\n⚠️ Reached maximum recording duration (${MAX_DURATION_MINUTES} mins). Stopping bot.`);
      keepRecording = false;
      break;
    }

    // Keep page interaction alive (simulates mouse activity to prevent idle disconnects)
    await page.mouse.move(150, 150).catch(() => {});
    await page.mouse.move(450, 350).catch(() => {});

    // 1. Check if the host explicitly ended the call or removed the bot
    const endedIndicator = page.locator(
      'text="The host ended the meeting", text="Meeting ended", text="You\'ve been removed", text="You were removed", text="The call ended", div:has-text("You left the meeting")'
    );
    const hasEnded = await endedIndicator.first().isVisible({ timeout: 1000 }).catch(() => false);
    if (hasEnded) {
      console.log(`\n🚪 Meeting end indicator detected (Host ended call or removed bot). Leaving now.`);
      keepRecording = false;
      break;
    }

    // 2. Check if URL navigated away from the meeting call
    const currentUrl = page.url();
    if (!currentUrl.includes('meet.google.com/')) {
      console.log(`\n🚪 Navigated away from meeting room URL (${currentUrl}). Disconnecting bot.`);
      keepRecording = false;
      break;
    }

    // 3. Check participant presence with arrival grace period and consecutive check buffer
    try {
      const alonePrompt = await page.locator('text="You\'re the only one here"').isVisible({ timeout: 1000 }).catch(() => false);
      
      let participantCount = null;
      let participantText = await page.locator('div[aria-label="Show everyone"] + span').textContent().catch(() => null);
      if (!participantText) {
        participantText = await page.locator('button[aria-label*="people" i] span, button[aria-label*="participant" i] span').textContent().catch(() => null);
      }
      if (participantText) {
        const count = parseInt(participantText.replace(/\D/g, ''), 10);
        if (!isNaN(count)) {
          participantCount = count;
        }
      }

      const isAlone = alonePrompt || (participantCount !== null && participantCount <= 1);

      if (isAlone) {
        if (isGracePeriod) {
          // Inside 15-minute start window: never leave, wait patiently for teacher & student
          consecutiveAloneCount = 0;
          const remainingGrace = ((START_GRACE_PERIOD_MS - elapsedTime) / (60 * 1000)).toFixed(1);
          // Log status every 30 seconds
          if (Math.floor(elapsedTime / 10000) % 3 === 0) {
            console.log(`\n⏳ [${elapsedMinutes}m elapsed] Waiting for class participants to join (${remainingGrace}m grace period remaining).`);
          }
        } else {
          // Past 15-minute start window: buffer consecutive empty checks
          consecutiveAloneCount++;
          console.log(`\n⚠️ [${elapsedMinutes}m elapsed] Room appears empty (${consecutiveAloneCount}/${REQUIRED_ALONE_CHECKS} consecutive checks).`);
          if (consecutiveAloneCount >= REQUIRED_ALONE_CHECKS) {
            console.log(`\n🚪 Everyone has left the meeting (room empty for 3 consecutive minutes). Ending session.`);
            keepRecording = false;
            break;
          }
        }
      } else {
        // Room has participants! Reset alone counter
        consecutiveAloneCount = 0;
      }
    } catch (e) {
      // Ignored if UI layout varies
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
