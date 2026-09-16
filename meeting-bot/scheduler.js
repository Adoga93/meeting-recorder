const { google } = require('googleapis');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '18Cs5gzcBCfG5tFETyOgNcqU4bi8W-8g44PvD3NYkMaI';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const DISPATCHED_PATH = path.join(__dirname, 'dispatched_sessions.json');
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

// Load or initialize dispatched sessions tracker
function getDispatchedSessions() {
  if (fs.existsSync(DISPATCHED_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(DISPATCHED_PATH, 'utf8'));
    } catch (e) {
      console.error('⚠️ Could not parse dispatched_sessions.json, starting fresh:', e.message);
    }
  }
  return {};
}

function saveDispatchedSessions(data) {
  try {
    fs.writeFileSync(DISPATCHED_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Failed to save dispatched_sessions.json:', e.message);
  }
}

// Initialize Google Sheets API client
function getSheetsClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Google credentials file not found at ${CREDENTIALS_PATH}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

// Launch the recorder bot container for a specific meeting
function dispatchRecorderBot(session) {
  const { sessionId, meetingUrl, teacherName, studentName, subject } = session;
  const botPath = __dirname;
  const recordingsPath = path.join(botPath, 'recordings');

  const botName = `PAS Tutors Recorder`;
  const dockerCmd = `docker run --rm -d -v "${path.join(botPath, 'bot.js')}:/app/bot.js" -v "${recordingsPath}:/app/recordings" -e MEETING_URL="${meetingUrl}" -e BOT_NAME="${botName}" meeting-bot`;

  console.log(`\n======================================================`);
  console.log(`🚀 [AUTO-SCHEDULER] DISPATCHING RECORDER BOT FOR CLASS:`);
  console.log(`📌 Session ID: ${sessionId}`);
  console.log(`👨‍🏫 Teacher:    ${teacherName}`);
  console.log(`🎓 Student:    ${studentName}`);
  console.log(`📚 Subject:    ${subject}`);
  console.log(`🔗 Link:       ${meetingUrl}`);
  console.log(`⚡ Command:    ${dockerCmd}`);
  console.log(`======================================================\n`);

  exec(dockerCmd, { cwd: botPath }, (err, stdout, stderr) => {
    if (err) {
      console.error(`❌ [AUTO-SCHEDULER] Failed to spawn container: ${err.message}`);
      return;
    }

    const containerId = stdout.trim();
    console.log(`🟢 [AUTO-SCHEDULER] Bot Container Launched! Container ID: ${containerId}`);

    // Wait for container completion to auto-upload to Google Drive
    exec(`docker wait ${containerId}`, { cwd: botPath }, (waitErr) => {
      if (!waitErr) {
        console.log(`🎬 [AUTO-SCHEDULER] Class ended for session ${sessionId}. Triggering Google Drive upload...`);
        exec(`node upload_drive.js`, { cwd: botPath }, (upErr, upOut) => {
          if (upErr) {
            console.error(`❌ [AUTO-SCHEDULER] Drive upload error:`, upErr.message);
          } else {
            console.log(`☁️ [AUTO-SCHEDULER] Google Drive upload finished:\n`, upOut);
          }
        });
      }
    });
  });
}

// Parse scheduled time string into a Date object (supporting multiple formats)
function parseScheduledTime(timeStr) {
  if (!timeStr) return null;
  const cleaned = timeStr.trim();
  
  // Format: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD HH:MM"
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(cleaned)) {
    const parts = cleaned.split(' ');
    const datePart = parts[0];
    const timePart = parts[1];
    return new Date(`${datePart}T${timePart}`);
  }

  const parsed = new Date(cleaned);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Scan the timetable and trigger eligible sessions
async function checkSchedule() {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sessions!A1:Z500'
    });

    const rows = res.data.values;
    if (!rows || rows.length < 2) {
      return;
    }

    const headers = rows[0];
    const sessionIdx = headers.indexOf('Session ID');
    const teacherIdx = headers.indexOf('Teacher Name');
    const studentIdx = headers.indexOf('Student Name');
    const subjectIdx = headers.indexOf('Subject');
    const timeIdx = headers.indexOf('Scheduled Time');
    const linkIdx = headers.indexOf('Meeting Link');
    const statusIdx = headers.indexOf('Status');

    const dispatched = getDispatchedSessions();
    const now = Date.now();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sessionId = row[sessionIdx];
      const teacherName = row[teacherIdx] || 'Teacher';
      const studentName = row[studentIdx] || 'Student';
      const subject = row[subjectIdx] || 'Class';
      const timeStr = row[timeIdx];
      const meetingLink = row[linkIdx];
      const status = row[statusIdx] || '';

      if (!sessionId || !meetingLink || !timeStr) continue;

      // Ensure valid URL scheme
      if (!meetingLink.startsWith('http://') && !meetingLink.startsWith('https://')) {
        continue;
      }

      // Do not re-dispatch if already completed or already dispatched
      if (status.toLowerCase().includes('completed')) continue;
      if (dispatched[sessionId]) continue;

      const scheduledDate = parseScheduledTime(timeStr);
      if (!scheduledDate) continue;

      const scheduledTimeMs = scheduledDate.getTime();
      const timeDiffMinutes = (scheduledTimeMs - now) / (1000 * 60);

      // Trigger window: between 2 minutes BEFORE class starts and up to 45 minutes after start
      if (timeDiffMinutes <= 2 && timeDiffMinutes >= -45) {
        console.log(`⏰ [MATCH FOUND] Session "${subject}" with ${studentName} scheduled for ${timeStr} (Diff: ${timeDiffMinutes.toFixed(1)} mins)`);
        
        // Mark as dispatched immediately
        dispatched[sessionId] = {
          dispatchedAt: new Date().toISOString(),
          teacherName,
          studentName,
          subject,
          scheduledTime: timeStr,
          meetingLink
        };
        saveDispatchedSessions(dispatched);

        // Trigger bot
        dispatchRecorderBot({
          sessionId,
          meetingUrl: meetingLink,
          teacherName,
          studentName,
          subject
        });
      }
    }
  } catch (err) {
    console.error('❌ [AUTO-SCHEDULER ERROR]:', err.message);
  }
}

console.log('======================================================');
console.log('🤖 PAS TUTORS 24/7 AUTOMATED CLASS RECORDER SCHEDULER');
console.log(`📊 Connected to Google Sheet ID: ${SHEET_ID}`);
console.log(`⏱️ Scanning frequency: Every ${CHECK_INTERVAL_MS / 1000} seconds`);
console.log('======================================================');

// Run initial check immediately, then periodically
checkSchedule();
setInterval(checkSchedule, CHECK_INTERVAL_MS);
