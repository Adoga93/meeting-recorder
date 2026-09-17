import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const SHEET_ID = '18Cs5gzcBCfG5tFETyOgNcqU4bi8W-8g44PvD3NYkMaI';
const botPath = path.resolve(process.cwd(), '../meeting-bot');
const CREDENTIALS_PATH = path.join(botPath, 'credentials.json');
const DISPATCHED_PATH = path.join(botPath, 'dispatched_sessions.json');
const CONFIG_PATH = path.join(botPath, 'scheduler_config.json');
const TIMEZONE = 'Africa/Lagos';

function normalizeName(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getDispatchedSessions() {
  if (fs.existsSync(DISPATCHED_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(DISPATCHED_PATH, 'utf8'));
    } catch (e) {}
  }
  return {};
}

function getMode() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return data.mode || 'manual';
    } catch (e) {}
  }
  return 'manual';
}

function saveMode(mode) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mode }, null, 2), 'utf8');
  } catch (e) {}
}

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

export async function GET() {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return NextResponse.json({ error: 'Credentials not found' }, { status: 500 });
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

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

    const now = new Date();
    const todayDayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TIMEZONE }).format(now);
    const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now);

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

          // ONLY INCLUDE CLASSES WITH A VALID MEETING LINK!
          if (!meetingUrl || (!meetingUrl.startsWith('http://') && !meetingUrl.startsWith('https://'))) {
            continue;
          }

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

    const dispatched = getDispatchedSessions();

    const result = todayClasses.map(c => ({
      ...c,
      isDispatched: !!dispatched[c.sessionId],
      dispatchedAt: dispatched[c.sessionId]?.dispatchedAt || null
    }));

    return NextResponse.json({
      success: true,
      mode: getMode(),
      todayDayName,
      todayDateStr,
      classes: result
    });

  } catch (err) {
    console.error('Schedule GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { action, mode } = await request.json();

    if (action === 'set_mode') {
      if (mode !== 'manual' && mode !== 'auto') {
        return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
      }
      saveMode(mode);
      return NextResponse.json({ success: true, mode });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
