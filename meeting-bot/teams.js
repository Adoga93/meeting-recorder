const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configure recording configurations via environment variables
const MEETING_URL = process.env.MEETING_URL || 'https://teams.microsoft.com/l/meetup-join/...';
const BOT_NAME = process.env.BOT_NAME || 'PAS Tutors Recorder';
const MAX_DURATION_MINUTES = parseInt(process.env.MAX_DURATION_MINUTES || '60', 10);

async function runTeamsBot() {
  console.log("==================================================");
  console.log(`🤖 STARTING MICROSOFT TEAMS RECORDER BOT`);
  console.log(`🔗 Meeting Link: ${MEETING_URL}`);
  console.log(`🏷️ Bot Display Name: ${BOT_NAME}`);
  console.log("==================================================");

  const recordingsDir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled',
      '--window-position=0,0'
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
    console.log(`🌐 Navigating to Teams meeting URL...`);
    await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    // 1. Bypass "Download Windows App / Open Teams App" prompt by choosing browser join
    console.log("🔍 Checking for 'Continue on this browser' option...");
    const webJoinSelectors = [
      'button[data-tid="joinOnWeb"]',
      'a[data-tid="joinOnWeb"]',
      'button:has-text("Continue on this browser")',
      'a:has-text("Continue on this browser")',
      'button:has-text("Join on the web instead")',
      'a:has-text("Join on the web instead")'
    ];

    for (const selector of webJoinSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 4000 })) {
          await btn.click({ force: true });
          console.log(`🖱️ Clicked browser join: ${selector}`);
          await page.waitForTimeout(5000);
          break;
        }
      } catch (e) {}
    }

    // 2. Look for name input field on the pre-join screen
    console.log("📝 Looking for display name input field...");
    const nameInputSelectors = [
      'input[data-tid="prejoin-display-name-input"]',
      'input#username',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
      'input[name*="name" i]'
    ];

    let nameInputFound = false;
    for (const selector of nameInputSelectors) {
      try {
        const input = page.locator(selector).first();
        if (await input.isVisible({ timeout: 15000 })) {
          await input.fill(BOT_NAME);
          console.log(`✅ Filled display name: "${BOT_NAME}" using selector ${selector}`);
          nameInputFound = true;
          break;
        }
      } catch (e) {}
    }

    if (!nameInputFound) {
      console.warn("⚠️ Display name field not explicitly found. May already be populated or signed in.");
    }

    // 3. Ensure Camera and Mic are muted before entering
    console.log("🔇 Ensuring camera and microphone are toggled off...");
    try {
      // Toggle video off if active
      const cameraBtn = page.locator('button[aria-label*="Turn camera off" i], div[data-tid="toggle-video"][aria-checked="true"]').first();
      if (await cameraBtn.isVisible({ timeout: 3000 })) {
        await cameraBtn.click();
        console.log("📷 Turned camera OFF");
      }
    } catch (e) {}

    try {
      // Toggle mic off if active
      const micBtn = page.locator('button[aria-label*="Mute microphone" i], div[data-tid="toggle-mute"][aria-checked="true"]').first();
      if (await micBtn.isVisible({ timeout: 3000 })) {
        await micBtn.click();
        console.log("🎙️ Muted microphone");
      }
    } catch (e) {}

    await page.waitForTimeout(2000);

    // 4. Click the "Join now" button
    console.log("🚀 Clicking 'Join now' button...");
    const joinNowBtn = page.locator('button[data-tid="prejoin-join-button"], button:has-text("Join now"), button:has-text("Join meeting")').first();
    await joinNowBtn.waitFor({ state: 'visible', timeout: 25000 });
    await joinNowBtn.click({ force: true });
    console.log("⏳ Clicked 'Join now'. Checking for lobby or meeting entrance...");

    // 5. Check for lobby (waiting room) or direct entrance
    const meetingRoomIndicators = [
      'button[data-tid="call-hangup"]',
      'button[aria-label*="Leave" i]',
      'button[aria-label*="Hang up" i]',
      'div[data-tid="calling-roster"]',
      '#hangup-button'
    ];

    const lobbyIndicator = page.locator('text="We\'ve let people in the meeting know you\'re waiting", text="Someone in the meeting should let you in soon"');
    
    // Wait for either the lobby admission or active meeting room
    let inMeeting = false;
    const entranceTimeout = Date.now() + 180000; // Wait up to 3 minutes for teacher admission

    while (Date.now() < entranceTimeout && !inMeeting) {
      for (const selector of meetingRoomIndicators) {
        if (await page.locator(selector).first().isVisible({ timeout: 1000 }).catch(() => false)) {
          inMeeting = true;
          console.log(`🎉 Successfully entered the Microsoft Teams meeting room! (Matched: ${selector})`);
          break;
        }
      }

      if (!inMeeting) {
        if (await lobbyIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log("⏳ Currently waiting in Teams lobby for teacher to admit bot...");
        }
        await page.waitForTimeout(5000);
      }
    }

    if (!inMeeting) {
      console.warn("⚠️ Timed out waiting for entrance. Proceeding to record whatever is on screen.");
    }

  } catch (error) {
    console.error("❌ Error during Teams join sequence:", error.message);
    await page.screenshot({ path: path.join(recordingsDir, 'failed_teams_join.png') });
    await browser.close();
    process.exit(1);
  }

  // --- START FFMPEG RECORDING ---
  const outputFileName = `teams_${Date.now()}.mp4`;
  const outputFilePath = path.join(recordingsDir, outputFileName);
  console.log(`📹 Initializing FFmpeg recorder for Teams...`);
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

  console.log("🟢 Teams recording has started successfully!");

  // --- MONITOR LIFECYCLE ---
  const startTime = Date.now();
  const maxDurationMs = MAX_DURATION_MINUTES * 60 * 1000;
  let keepRecording = true;

  while (keepRecording) {
    await page.waitForTimeout(10000);

    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= maxDurationMs) {
      console.log("\n⚠️ Maximum recording duration reached. Ending session.");
      keepRecording = false;
      break;
    }

    // Check if the call has ended or we have been disconnected
    const endIndicators = [
      'text="The meeting has ended"',
      'text="You\'ve been removed from the meeting"',
      'text="You left the meeting"',
      'button:has-text("Rejoin")'
    ];

    for (const indicator of endIndicators) {
      if (await page.locator(indicator).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`\n🚪 Teams meeting ended: detected "${indicator}"`);
        keepRecording = false;
        break;
      }
    }

    if (!keepRecording) break;

    // Check if the hangup button is still in the DOM
    const hangupButton = page.locator('button[data-tid="call-hangup"], button[aria-label*="Hang up" i], #hangup-button').first();
    const hangupVisible = await hangupButton.isVisible().catch(() => false);
    if (!hangupVisible) {
      console.log("\n🚪 Leave/Hangup button disappeared. Meeting concluded.");
      keepRecording = false;
      break;
    }
  }

  // --- CLEANUP & FINALIZE ---
  console.log("\n🧹 Finalizing video file and stopping recorder...");
  ffmpegProcess.kill('SIGINT');
  await page.waitForTimeout(3000);
  await browser.close();
  console.log("🎉 Microsoft Teams recording completed successfully!");
}

module.exports = runTeamsBot;
