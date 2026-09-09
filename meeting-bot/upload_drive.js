const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { exec } = require('child_process');
const { drive, auth } = require('@googleapis/drive');

const BOT_DIR = __dirname;
const CLIENT_SECRET_PATH = path.join(BOT_DIR, 'client_secret.json');
const TOKEN_PATH = path.join(BOT_DIR, 'drive_token.json');
const REGISTRY_PATH = path.join(BOT_DIR, 'uploaded_recordings.json');
const RECORDINGS_DIR = path.join(BOT_DIR, 'recordings');
const FOLDER_NAME = 'Quick-Raman Meeting Recordings';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file'
];

/**
 * Load or initialize uploaded files registry
 */
function loadRegistry() {
  if (fs.existsSync(REGISTRY_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Could not parse uploaded_recordings.json, initializing empty registry.');
    }
  }
  return {};
}

function saveRegistry(registry) {
  try {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Failed to save uploaded_recordings.json:', e.message);
  }
}

/**
 * Load OAuth2 Client Credentials
 */
function getOAuth2Client(redirectUri = 'http://localhost:8085/oauth2callback') {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(`Missing client_secret.json at ${CLIENT_SECRET_PATH}. Please provide Google OAuth2 credentials.`);
  }

  const content = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  const credentials = content.installed || content.web;
  if (!credentials) {
    throw new Error('client_secret.json does not contain "installed" or "web" credentials configuration.');
  }

  const { client_id, client_secret } = credentials;
  return new auth.OAuth2(client_id, client_secret, redirectUri);
}

/**
 * Open URL in default system browser
 */
function openBrowser(targetUrl) {
  const start = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${start} "${targetUrl}"`);
}

/**
 * Authenticate and obtain valid tokens (one-time interactive flow if needed)
 */
async function getAuthenticatedClient() {
  const oauth2Client = getOAuth2Client();

  // 1. Check if token already exists
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oauth2Client.setCredentials(tokens);

      // Auto-save refreshed tokens
      oauth2Client.on('tokens', (newTokens) => {
        const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8') || '{}');
        const merged = { ...currentTokens, ...newTokens };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), 'utf8');
        console.log('🔄 Google Drive access token refreshed automatically.');
      });

      return oauth2Client;
    } catch (e) {
      console.warn('⚠️ Existing drive_token.json is invalid. Re-authenticating...');
    }
  }

  // 2. Perform one-time interactive OAuth authorization
  return new Promise((resolve, reject) => {
    const port = 8085;
    const redirectUri = `http://localhost:${port}/oauth2callback`;
    const clientWithPort = getOAuth2Client(redirectUri);

    const authUrl = clientWithPort.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES
    });

    console.log('\n======================================================');
    console.log('🔐 Google Drive Authorization Required for odeadoga93@gmail.com');
    console.log('======================================================');
    console.log('Opening your browser to authenticate Google Drive access...');
    console.log('\nIf your browser does not open automatically, visit this URL:');
    console.log(authUrl);
    console.log('======================================================\n');

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = url.parse(req.url, true);
        if (reqUrl.pathname === '/oauth2callback') {
          const code = reqUrl.query.code;

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h3>❌ Authorization failed: No code provided.</h3>');
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0d1117; color:#f0f6fc; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
                <div style="background:#161b22; border:1px solid #30363d; border-radius:12px; padding:32px; text-align:center; max-width:480px; box-shadow:0 8px 24px rgba(0,0,0,0.5);">
                  <h2 style="color:#2ea043; margin-top:0;">🎉 Google Drive Connected!</h2>
                  <p style="color:#8b949e; line-height:1.5;">Quick-Raman is now authorized to upload meeting recordings to your Google Drive.</p>
                  <p style="font-size:13px; color:#58a6ff;">You can close this tab and return to your application.</p>
                </div>
              </body>
            </html>
          `);

          server.close();

          const { tokens } = await clientWithPort.getToken(code);
          clientWithPort.setCredentials(tokens);
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
          console.log('✅ Google Drive authorization successful! Saved to drive_token.json');

          resolve(clientWithPort);
        }
      } catch (err) {
        console.error('❌ Error exchanging auth code:', err);
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {
      openBrowser(authUrl);
    });

    server.on('error', (err) => {
      console.error('❌ Local auth server error:', err.message);
      reject(err);
    });
  });
}

/**
 * Get or create the destination folder in Google Drive
 */
async function getOrCreateFolder(drive) {
  try {
    const listRes = await drive.files.list({
      q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (listRes.data.files && listRes.data.files.length > 0) {
      return listRes.data.files[0].id;
    }

    console.log(`📁 Creating Google Drive folder: "${FOLDER_NAME}"...`);
    const createRes = await drive.files.create({
      requestBody: {
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    return createRes.data.id;
  } catch (err) {
    console.error('❌ Failed to verify/create Drive folder:', err.message);
    throw err;
  }
}

/**
 * Upload a single video file to Google Drive
 */
async function uploadFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  const registry = loadRegistry();

  if (registry[fileName]) {
    console.log(`ℹ️ File "${fileName}" was already uploaded to Drive: ${registry[fileName].webViewLink}`);
    return registry[fileName];
  }

  const stats = fs.statSync(filePath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(1);
  console.log(`\n🚀 Uploading "${fileName}" (${fileSizeMB} MB) to Google Drive...`);

  const authClient = await getAuthenticatedClient();
  const driveClient = drive({ version: 'v3', auth: authClient });

  const folderId = await getOrCreateFolder(driveClient);

  const fileMetadata = {
    name: fileName,
    parents: [folderId]
  };

  const media = {
    mimeType: 'video/mp4',
    body: fs.createReadStream(filePath)
  };

  const startTime = Date.now();
  const response = await driveClient.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink, webContentLink, size'
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Upload completed in ${durationSec}s!`);
  console.log(`🔗 Drive Link: ${response.data.webViewLink}`);

  const record = {
    fileId: response.data.id,
    fileName: fileName,
    webViewLink: response.data.webViewLink,
    webContentLink: response.data.webContentLink,
    size: response.data.size || stats.size,
    uploadedAt: new Date().toISOString()
  };

  registry[fileName] = record;
  saveRegistry(registry);

  return record;
}

/**
 * Upload all un-uploaded MP4 files in recordings/
 */
async function uploadAllRecordings() {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    console.log('No recordings folder found.');
    return [];
  }

  const files = fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.mp4') || f.endsWith('.webm'));
  const registry = loadRegistry();
  const pendingFiles = files.filter(f => !registry[f]);

  if (pendingFiles.length === 0) {
    console.log('✨ All recordings are already uploaded to Google Drive!');
    return [];
  }

  console.log(`📦 Found ${pendingFiles.length} recordings pending upload to Google Drive.`);
  const results = [];

  for (const file of pendingFiles) {
    const fullPath = path.join(RECORDINGS_DIR, file);
    try {
      const result = await uploadFile(fullPath);
      results.push(result);
    } catch (e) {
      console.error(`❌ Error uploading ${file}:`, e.message);
    }
  }

  return results;
}

// Command-line execution
if (require.main === module) {
  const args = process.argv.slice(2);

  (async () => {
    try {
      if (args.includes('--auth-only')) {
        console.log('Running OAuth2 authentication check...');
        await getAuthenticatedClient();
        console.log('✅ Authentication verified.');
        process.exit(0);
      }

      if (args.length > 0 && !args[0].startsWith('--')) {
        const targetPath = path.isAbsolute(args[0]) ? args[0] : path.join(process.cwd(), args[0]);
        await uploadFile(targetPath);
      } else {
        await uploadAllRecordings();
      }
    } catch (err) {
      console.error('Fatal upload error:', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  uploadFile,
  uploadAllRecordings,
  getAuthenticatedClient,
  loadRegistry
};
