import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execPromise = util.promisify(exec);

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
    const dockerCmd = `docker run --rm -d -v "${path.join(botPath, 'bot.js')}:/app/bot.js" -v "${recordingsPath}:/app/recordings" -e MEETING_URL="${meetingUrl}" -e BOT_NAME="${botName || 'PAS Tutors Recorder'}" meeting-bot`;

    console.log(`Executing: ${dockerCmd}`);

    let stdout, stderr;
    try {
      const result = await execPromise(dockerCmd, { cwd: botPath });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (cmdErr) {
      console.error(`❌ Docker trigger execution error:`, cmdErr.message);
      
      let userFriendlyError = cmdErr.message;
      if (cmdErr.message.includes('docker API') || cmdErr.message.includes('daemon is running') || cmdErr.message.includes('npipe')) {
        userFriendlyError = 'Docker Desktop Engine is not running on this machine. Please start Docker Desktop and try again.';
      }

      return NextResponse.json({ 
        error: `Failed to launch recorder bot: ${userFriendlyError}` 
      }, { status: 500 });
    }

    const containerId = stdout.trim();
    console.log(`🟢 Docker container launched successfully. ID: ${containerId}`);

    // Auto-upload to Google Drive upon container termination (runs in background)
    exec(`docker wait ${containerId}`, { cwd: botPath }, (waitErr) => {
      if (!waitErr) {
        console.log(`🎬 Recording session finished for container ${containerId}. Auto-uploading to Google Drive...`);
        exec(`node upload_drive.js`, { cwd: botPath }, (upErr, upOut) => {
          if (upErr) console.error(`❌ Auto-upload error:`, upErr.message);
          else console.log(`☁️ Auto-upload output:\n`, upOut);
        });
      }
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Bot container initiated successfully',
      containerId,
      meetingUrl,
      botName
    });

  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal server error: ' + err.message }, { status: 500 });
  }
}
