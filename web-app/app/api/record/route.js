import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function POST(request) {
  try {
    const { meetingUrl, botName } = await request.json();

    if (!meetingUrl) {
      return NextResponse.json({ error: 'Meeting URL is required' }, { status: 400 });
    }

    console.log(`🤖 Backend starting recording bot: ${meetingUrl} with name "${botName}"`);

    const botPath = process.env.BOT_PATH || path.resolve(process.cwd(), '../meeting-bot');
    const recordingsPath = path.join(botPath, 'recordings');
    
    // Command to launch the Docker container in the background
    const dockerCmd = `docker run --rm -d -v "${path.join(botPath, 'bot.js')}:/app/bot.js" -v "${recordingsPath}:/app/recordings" -e MEETING_URL="${meetingUrl}" -e BOT_NAME="${botName}" meeting-bot`;

    console.log(`Executing: ${dockerCmd}`);

    exec(dockerCmd, { cwd: botPath }, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Docker trigger error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.warn(`⚠️ Docker output warning: ${stderr}`);
      }
      const containerId = stdout.trim();
      console.log(`🟢 Docker container launched successfully. ID: ${containerId}`);

      // Auto-upload to Google Drive upon container termination
      exec(`docker wait ${containerId}`, { cwd: botPath }, (waitErr) => {
        if (!waitErr) {
          console.log(`🎬 Recording session finished for container ${containerId}. Auto-uploading to Google Drive...`);
          exec(`node upload_drive.js`, { cwd: botPath }, (upErr, upOut) => {
            if (upErr) console.error(`❌ Auto-upload error:`, upErr.message);
            else console.log(`☁️ Auto-upload output:\n`, upOut);
          });
        }
      });
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Bot container initiated successfully',
      meetingUrl,
      botName
    });

  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal server error: ' + err.message }, { status: 500 });
  }
}
