import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

const botPath = "C:/Users/user/Documents/antigravity/quick-raman/meeting-bot";
const registryPath = `${botPath}/uploaded_recordings.json`;

export async function GET() {
  try {
    let registry = {};
    if (fs.existsSync(registryPath)) {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    }
    const tokenExists = fs.existsSync(`${botPath}/drive_token.json`);

    return NextResponse.json({
      authenticated: tokenExists,
      uploadedCount: Object.keys(registry).length,
      registry
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { fileName } = await request.json().catch(() => ({}));

    let cmd = 'node upload_drive.js';
    if (fileName) {
      cmd = `node upload_drive.js "${botPath}/recordings/${fileName}"`;
    }

    console.log(`☁️ WebApp triggering Drive upload: ${cmd}`);

    return new Promise((resolve) => {
      exec(cmd, { cwd: botPath }, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Upload trigger failed:', error.message);
          resolve(NextResponse.json({ success: false, error: error.message, output: stderr }, { status: 500 }));
        } else {
          console.log('✅ Upload completed:', stdout);
          resolve(NextResponse.json({ success: true, message: 'Upload completed', output: stdout }));
        }
      });
    });

  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
