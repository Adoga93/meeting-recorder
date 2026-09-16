const { google } = require('googleapis');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '18Cs5gzcBCfG5tFETyOgNcqU4bi8W-8g44PvD3NYkMaI';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const DISPATCHED_PATH = path.join(__dirname, 'dispatched_sessions.json');
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds
const TIMEZONE = 'Africa/Lagos'; // WAT / UTC+1

function normalizeName(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

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
  const { sessionId, meetingUrl, teacherName, studentName, subject, scheduledTime } = session;
  const botPath = __dirname;
  const recordingsPath = path.join(botPath, 'recordings');

  if (!fs.existsSync(recordingsPath)) {
    fs.mkdirSync(recordingsPath, { recursive: true });
  }

  const botName = `PAS Tutors Recorder`;
  const dockerCmd = `docker run --rm -d -v "${path.join(botPath, 'bot.js')}:/app/bot.js" -v "${recordingsPath}:/app/recordings" -e MEETING_URL="${meetingUrl}" -e BOT_NAME="${botName}" meeting-bot`;

  console.log(`\n======================================================`);
  console.log(`🚀 [AUTO-SCHEDULER] DISPATCHING RECORDER BOT FOR CLASS:`);
  console.log(`📌 Session ID:    ${sessionId}`);
  console.log(`👨‍🏫 Teacher:       ${teacherName}`);
  console.log(`🎓 Student:       ${studentName}`);
  console.log(`📚 Subject:       ${subject}`);
  console.log(`⏰ Time:          ${scheduledTime}`);
  console.log(`🔗 Link:          ${meetingUrl}`);
  console.log(`⚡ Command:       ${dockerCmd}`);
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

// Parse class time string e.g. "05:00 PM" into a Date object for today
function getScheduledDateForToday(timeStr, todayDateStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();

  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return new Date(`${todayDateStr}T${hh}:${mm}:00+01:00`);
}

// Parse student "Class Times" column into structured class entries
// Format example: "Maths (Wed 05:00 PM - 06:00 PM) [Oluwabunmi Abe-Osuntoyinbo], English (Fri 04:00 PM - 05:00 PM) [Oluwabunmi Abe-Osuntoyinbo]"
function parseStudentClassTimes(classTimesStr) {
  if (!classTimesStr) return [];
  const entries = [];
  const parts = classTimesStr.split(/,(?![^\[]*\])/);

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    let assignedTeacher = null;
    const teacherMatch = part.match(/\[([^\]]+)\]/);
    if (teacherMatch) {
      assignedTeacher = teacherMatch[1].trim();
      part = part.replace(teacherMatch[0], '').trim();
    }

    const m = part.match(/^([^(]+)\(([^)]+)\)$/);
    if (!m) continue;

    const subject = m[1].trim();
    const timeInfo = m[2].trim();

    const timeParts = timeInfo.split(/\s+/);
    if (timeParts.length < 2) continue;

    let day = timeParts[0];
    const dayMap = {
      mon: 'Monday', monday: 'Monday',
      tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
      wed: 'Wednesday', wednesday: 'Wednesday',
      thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
      fri: 'Friday', friday: 'Friday',
      sat: 'Saturday', saturday: 'Saturday',
      sun: 'Sunday', sunday: 'Sunday'
    };
    const fullDay = dayMap[day.toLowerCase()];
    if (!fullDay) continue;

    const timeSpan = timeParts.slice(1).join(' ');
    const spanParts = timeSpan.split('-');
    const startTimeStr = spanParts[0].trim();
    const endTimeStr = spanParts.length > 1 ? spanParts[1].trim() : '';

    entries.push({
      subject,
      day: fullDay,
      startTime: startTimeStr,
      endTime: endTimeStr,
      assignedTeacher
    });
  }
  return entries;
}

// Scan the Master Schedule and trigger eligible sessions
async function checkSchedule() {
  try {
    const sheets = getSheetsClient();

    // Fetch Students, Weekly_Plans, and Teachers tabs in parallel
    const [studentsRes, plansRes, teachersRes, sessionsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Students!A1:Z200' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Weekly_Plans!A1:Z500' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Teachers!A1:Z100' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Sessions!A1:Z500' })
    ]);

    const studentRows = studentsRes.data.values || [];
    const planRows = plansRes.data.values || [];
    const teacherRows = teachersRes.data.values || [];
    const sessionRows = sessionsRes.data.values || [];

    // Current date and time in WAT (UTC+1)
    const now = new Date();
    const todayDayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TIMEZONE }).format(now);
    const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now); // "YYYY-MM-DD"

    // 1. Build Meeting Links Map from Weekly_Plans tab
    const meetingLinksMap = {};
    if (planRows.length > 1) {
      const pHeaders = planRows[0];
      const pTeacherIdx = pHeaders.indexOf('Teacher Name');
      const pStudentIdx = pHeaders.indexOf('Student Name');
      const pLinkIdx = pHeaders.indexOf('Meeting Link');

      for (let i = 1; i < planRows.length; i++) {
        const r = planRows[i];
        const tNorm = normalizeName(r[pTeacherIdx]);
        const sNorm = normalizeName(r[pStudentIdx]);
        const link = (r[pLinkIdx] || '').trim();
        if (link && (link.startsWith('http://') || link.startsWith('https://'))) {
          if (tNorm && sNorm) meetingLinksMap[`${tNorm}::${sNorm}`] = link;
          if (sNorm && !meetingLinksMap[`any::${sNorm}`]) meetingLinksMap[`any::${sNorm}`] = link;
        }
      }
    }

    // 2. Build Student-Teacher Map from Teachers tab
    const studentTeacherMap = {};
    if (teacherRows.length > 1) {
      const tHeaders = teacherRows[0];
      const tNameIdx = tHeaders.indexOf('Teacher Name');
      const tAssignedIdx = tHeaders.indexOf('Assigned Students');
      const tExpIdx = tHeaders.indexOf('Subject Expertise');

      for (let i = 1; i < teacherRows.length; i++) {
        const r = teacherRows[i];
        const tName = (r[tNameIdx] || '').trim();
        const assignedStr = (r[tAssignedIdx] || '').trim();
        const expertise = (r[tExpIdx] || '').toLowerCase();
        if (!tName || !assignedStr) continue;

        const assignedList = assignedStr.split(',').map(s => s.trim()).filter(Boolean);
        for (let s of assignedList) {
          const sNorm = normalizeName(s);
          if (!studentTeacherMap[sNorm]) studentTeacherMap[sNorm] = [];
          studentTeacherMap[sNorm].push({ name: tName, expertise });
        }
      }
    }

    // 3. Extract all classes for TODAY from Students tab
    const todayClasses = [];
    if (studentRows.length > 1) {
      const sHeaders = studentRows[0];
      const sNameIdx = sHeaders.indexOf('Student Name');
      const sTimesIdx = sHeaders.indexOf('Class Times');

      for (let i = 1; i < studentRows.length; i++) {
        const r = studentRows[i];
        const studentName = (r[sNameIdx] || '').trim();
        const classTimes = (r[sTimesIdx] || '').trim();
        if (!studentName || !classTimes) continue;

        const parsedList = parseStudentClassTimes(classTimes);
        const sNorm = normalizeName(studentName);

        for (let cls of parsedList) {
          if (cls.day.toLowerCase() !== todayDayName.toLowerCase()) continue;

          let teacherName = cls.assignedTeacher;
          if (!teacherName) {
            const potential = studentTeacherMap[sNorm] || [];
            const subjLower = cls.subject.toLowerCase();
            const matched = potential.filter(p => !p.expertise || p.expertise.includes(subjLower));
            teacherName = matched.length > 0 ? matched[0].name : (potential[0] ? potential[0].name : 'Assigned Teacher');
          }

          const tNorm = normalizeName(teacherName);
          const meetingUrl = meetingLinksMap[`${tNorm}::${sNorm}`] || meetingLinksMap[`any::${sNorm}`] || '';

          // Unique stable session key for today
          const sessionId = `MASTER_${todayDateStr}_${sNorm}_${normalizeName(cls.subject)}_${cls.startTime.replace(/[^a-zA-Z0-9]/g, '')}`;

          todayClasses.push({
            sessionId,
            teacherName,
            studentName,
            subject: cls.subject,
            startTime: cls.startTime,
            endTime: cls.endTime,
            meetingUrl
          });
        }
      }
    }

    // 4. Also include any ad-hoc classes in Sessions tab for today
    if (sessionRows.length > 1) {
      const sessHeaders = sessionRows[0];
      const sIdIdx = sessHeaders.indexOf('Session ID');
      const sTeacherIdx = sessHeaders.indexOf('Teacher Name');
      const sStudentIdx = sessHeaders.indexOf('Student Name');
      const sSubjIdx = sessHeaders.indexOf('Subject');
      const sTimeIdx = sessHeaders.indexOf('Scheduled Time');
      const sLinkIdx = sessHeaders.indexOf('Meeting Link');
      const sStatusIdx = sessHeaders.indexOf('Status');

      for (let i = 1; i < sessionRows.length; i++) {
        const r = sessionRows[i];
        const timeStr = r[sTimeIdx] || '';
        const status = (r[sStatusIdx] || '').toLowerCase();
        const link = (r[sLinkIdx] || '').trim();

        if (status.includes('completed') || status.includes('cancel')) continue;
        if (!timeStr.includes(todayDateStr) || !link) continue;

        const sId = r[sIdIdx] || `SESS_${i}`;
        todayClasses.push({
          sessionId: sId,
          teacherName: r[sTeacherIdx] || 'Teacher',
          studentName: r[sStudentIdx] || 'Student',
          subject: r[sSubjIdx] || 'Class',
          startTime: timeStr,
          endTime: '',
          meetingUrl: link
        });
      }
    }

    const dispatched = getDispatchedSessions();
    const nowMs = now.getTime();

    console.log(`\n--- [AUTO-SCHEDULER SCAN: ${todayDayName}, ${todayDateStr} ${now.toLocaleTimeString('en-GB', { timeZone: TIMEZONE })}] ---`);
    console.log(`📋 Total Master Classes Scheduled Today: ${todayClasses.length}`);

    for (let c of todayClasses) {
      const scheduledDate = getScheduledDateForToday(c.startTime, todayDateStr);
      if (!scheduledDate) {
        console.log(`⚠️ Could not parse time: "${c.startTime}" for ${c.studentName}`);
        continue;
      }

      const diffMins = (scheduledDate.getTime() - nowMs) / (1000 * 60);
      const isDispatched = !!dispatched[c.sessionId];

      console.log(`   ⏰ [${c.startTime}] ${c.subject} (${c.studentName} & ${c.teacherName}) -> In ${diffMins.toFixed(1)} mins | Link: ${c.meetingUrl ? '✅ Attached' : '❌ Missing'} | Dispatched: ${isDispatched ? 'Yes' : 'No'}`);

      // TRIGGER WINDOW:
      // Join starting 3 minutes BEFORE class start time, up to 45 minutes AFTER class start time
      if (diffMins <= 3 && diffMins >= -45) {
        if (isDispatched) {
          continue;
        }

        if (!c.meetingUrl || (!c.meetingUrl.startsWith('http://') && !c.meetingUrl.startsWith('https://'))) {
          console.log(`⚠️ [CANNOT JOIN] No valid meeting link attached for ${c.studentName} (${c.subject}).`);
          continue;
        }

        console.log(`🎯 [TRIGGERING RECORDING BOT] Time window reached for ${c.studentName} (${c.subject})!`);

        dispatched[c.sessionId] = {
          dispatchedAt: new Date().toISOString(),
          teacherName: c.teacherName,
          studentName: c.studentName,
          subject: c.subject,
          scheduledTime: c.startTime,
          meetingUrl: c.meetingUrl
        };
        saveDispatchedSessions(dispatched);

        dispatchRecorderBot({
          sessionId: c.sessionId,
          meetingUrl: c.meetingUrl,
          teacherName: c.teacherName,
          studentName: c.studentName,
          subject: c.subject,
          scheduledTime: c.startTime
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
console.log(`🌍 Timezone: ${TIMEZONE}`);
console.log(`⏱️ Scanning frequency: Every ${CHECK_INTERVAL_MS / 1000} seconds`);
console.log('======================================================');

// Run initial check immediately, then periodically
checkSchedule();
setInterval(checkSchedule, CHECK_INTERVAL_MS);
