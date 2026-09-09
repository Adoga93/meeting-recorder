import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const recordingsDir = 'C:\\Users\\user\\Documents\\antigravity\\quick-raman\\meeting-bot\\recordings';

    // Ensure recordings directory exists
    if (!fs.existsSync(recordingsDir)) {
      return NextResponse.json({ recordings: [] });
    }

    // Read files from the recordings folder
    const files = fs.readdirSync(recordingsDir);

    // Filter files (we only want actual video recordings, and exclude things like debug screenshots)
    const mediaFiles = files.filter(file => file.endsWith('.mp4') || file.endsWith('.webm'));

    const registryPath = 'C:\\Users\\user\\Documents\\antigravity\\quick-raman\\meeting-bot\\uploaded_recordings.json';
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
