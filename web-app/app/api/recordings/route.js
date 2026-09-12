import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const botPath = process.env.BOT_PATH || path.resolve(process.cwd(), '../meeting-bot');
    const recordingsDir = path.join(botPath, 'recordings');
    const registryPath = path.join(botPath, 'uploaded_recordings.json');
    let mediaFiles = [];
    if (fs.existsSync(recordingsDir)) {
      const files = fs.readdirSync(recordingsDir);
      mediaFiles = files.filter(file => file.endsWith('.mp4') || file.endsWith('.webm'));
    }

    let driveRegistry = {};
    if (fs.existsSync(registryPath)) {
      try {
        driveRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      } catch (e) {}
    }

    const recordingsList = mediaFiles.map((file, index) => {
      const filePath = path.join(recordingsDir, file);
      const stats = fs.statSync(filePath);

      // Extract duration/platform from filename pattern (e.g. meeting_1717838421034.mp4)
      const parts = file.split('_');
      const timestamp = parts[1] ? parseInt(parts[1].split('.')[0]) : Date.now();
      const timeString = new Date(timestamp).toLocaleString();

      const driveInfo = driveRegistry[file] || null;

      return {
        id: `rec-real-${index}`,
        title: `Meeting Session (${timeString})`,
        time: timeString,
        duration: "Recorded", 
        platform: "google_meet", // Default to Google Meet representation
        fileSize: `${(stats.size / (1024 * 1024)).toFixed(1)} MB`,
        fileName: file,
        filePath: filePath,
        participants: 'Unknown',
        drive: driveInfo
      };
    });

    // Sort by newest files first
    recordingsList.sort((a, b) => b.id.localeCompare(a.id));

    return NextResponse.json({ recordings: recordingsList });

  } catch (err) {
    console.error('API recordings fetch error:', err);
    return NextResponse.json({ error: 'Failed to read recordings directory' }, { status: 500 });
  }
}
