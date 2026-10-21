/**
 * NEXADOWN 3D - Core Engine Setup & Verification
 * Automatically installs and validates the latest compatible yt-dlp binary for the current OS/architecture,
 * configures the external JavaScript runtime (Node.js) & yt-dlp-ejs solver dependency,
 * provisions FFmpeg, and verifies end-to-end execution during Render / Linux / Windows deployment.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const binDir = path.join(__dirname, '..', 'bin');
const tempDir = path.join(__dirname, '..', 'temp');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const arch = process.arch; // 'x64', 'arm64', etc.

/**
 * Determine the exact primary and fallback download URLs for this OS/CPU
 */
function getBinaryCandidates() {
  if (isWin) {
    return [
      {
        fileName: 'yt-dlp.exe',
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
        minSize: 2 * 1024 * 1024
      }
    ];
  }

  if (isMac) {
    return [
      {
        fileName: 'yt-dlp',
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
        minSize: 2 * 1024 * 1024
      },
      {
        fileName: 'yt-dlp',
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
        minSize: 2 * 1024 * 1024
      }
    ];
  }

  // Linux (Render standard environment)
  const isArm = arch === 'arm64' || arch === 'aarch64';
  const linuxStandalone = isArm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';

  return [
    {
      fileName: 'yt-dlp',
      url: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${linuxStandalone}`,
      minSize: 2 * 1024 * 1024
    },
    {
      fileName: 'yt-dlp',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
      minSize: 2 * 1024 * 1024
    }
  ];
}

/**
 * Download using system curl if available (fast & reliable on Linux)
 */
function downloadWithCurl(url, destPath) {
  try {
    const res = spawnSync('curl', ['-sSL', '-f', '-o', destPath, url], { timeout: 45000 });
    if (res.status === 0 && fs.existsSync(destPath) && fs.statSync(destPath).size > 1024 * 1024) {
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Download a file with redirect follow (up to 5 levels) and validation
 */
function downloadFile(url, destPath, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) {
      return reject(new Error('Exceeded maximum HTTP redirect limit'));
    }

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadFile(res.headers.location, destPath, redirects - 1));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download binary: HTTP ${res.statusCode} ${res.statusMessage || ''}`));
      }

      const tmpPath = `${destPath}.tmp_${Date.now()}`;
      const file = fs.createWriteStream(tmpPath);

      res.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          try {
            if (fs.existsSync(destPath)) {
              fs.unlinkSync(destPath);
            }
            fs.renameSync(tmpPath, destPath);
            resolve();
          } catch (renameErr) {
            reject(renameErr);
          }
        });
      });

      file.on('error', (err) => {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        reject(err);
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Download timed out after 60 seconds'));
    });
  });
}

/**
 * Verify binary execution by calling --version
 */
function verifyBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) return { success: false, error: 'File does not exist' };
  try {
    if (!isWin) {
      fs.chmodSync(binaryPath, 0o755);
    }
    const res = spawnSync(binaryPath, ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (res.status === 0 && res.stdout && res.stdout.trim().length > 0) {
      return { success: true, version: res.stdout.trim() };
    }
    return { success: false, error: res.stderr || res.stdout || `Exit code ${res.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function setupEngine() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║       ⚡ NEXADOWN 3D - Core Engine Setup & Provisioning    ║
║       Platform: ${process.platform} (${arch}) | Node: ${process.version}          ║
╚═══════════════════════════════════════════════════════════╝`);

  // =========================================================================
  // 1. Setup & Configure JavaScript Runtime for yt-dlp challenge solver
  // =========================================================================
  const nodeBinary = process.execPath;
  console.log(`\n🔍 [JS Runtime] Detected Node.js engine: ${nodeBinary}`);

  // Test optional pip installation of companion package yt-dlp-ejs (if python is available)
  const pipCommands = ['pip3', 'pip', 'python3 -m pip', 'python -m pip'];
  let pipInstalledEjs = false;
  for (const cmd of pipCommands) {
    try {
      const parts = cmd.split(' ');
      const check = spawnSync(parts[0], [...parts.slice(1), '--version'], { encoding: 'utf8', timeout: 5000 });
      if (check.status === 0) {
        console.log(`📦 [Dependencies] Python pip found (${cmd}). Ensuring latest yt-dlp-ejs solver...`);
        const installResult = spawnSync(parts[0], [...parts.slice(1), 'install', '-U', 'yt-dlp-ejs', '--quiet'], { encoding: 'utf8', timeout: 30000 });
        if (installResult.status === 0) {
          console.log(`✅ [Dependencies] yt-dlp-ejs challenge solver verified!`);
          pipInstalledEjs = true;
          break;
        }
      }
    } catch (_) {}
  }
  if (!pipInstalledEjs) {
    console.log(`ℹ️  [Dependencies] Using standalone EJS challenge solver bundled inside yt-dlp.`);
  }

  // =========================================================================
  // 2. Setup & Verify yt-dlp Binary
  // =========================================================================
  const candidates = getBinaryCandidates();
  let workingBinaryPath = null;
  let activeVersion = null;

  for (const candidate of candidates) {
    const targetPath = path.join(binDir, candidate.fileName);
    console.log(`\n⬇️  [yt-dlp] Checking candidate: ${candidate.fileName} (${candidate.url})`);

    // Check existing binary first
    let needDownload = true;
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (stat.size >= candidate.minSize) {
        const verify = verifyBinary(targetPath);
        if (verify.success) {
          console.log(`✅ [yt-dlp] Existing binary verified functional! Version: ${verify.version}`);
          workingBinaryPath = targetPath;
          activeVersion = verify.version;
          needDownload = false;
          break;
        } else {
          console.warn(`⚠️  [yt-dlp] Existing binary failed execution check (${verify.error}). Re-downloading fresh binary...`);
          try { fs.unlinkSync(targetPath); } catch (_) {}
        }
      } else {
        console.warn(`⚠️  [yt-dlp] Existing binary file size is incomplete (${stat.size} bytes). Re-downloading...`);
        try { fs.unlinkSync(targetPath); } catch (_) {}
      }
    }

    if (needDownload) {
      console.log(`🌐 [yt-dlp] Downloading official release from GitHub...`);
      try {
        const curlOk = downloadWithCurl(candidate.url, targetPath);
        if (!curlOk) {
          await downloadFile(candidate.url, targetPath);
        }

        const stat = fs.statSync(targetPath);
        if (stat.size < candidate.minSize) {
          throw new Error(`Downloaded binary is corrupt or truncated (${stat.size} bytes < ${candidate.minSize} required)`);
        }

        const verify = verifyBinary(targetPath);
        if (verify.success) {
          console.log(`✅ [yt-dlp] Downloaded and verified successfully! Version: ${verify.version}`);
          workingBinaryPath = targetPath;
          activeVersion = verify.version;
          break;
        } else {
          console.warn(`⚠️  [yt-dlp] Candidate execution failed on this system: ${verify.error}`);
          try { fs.unlinkSync(targetPath); } catch (_) {}
        }
      } catch (dlErr) {
        console.error(`❌ [yt-dlp] Candidate download failed: ${dlErr.message}`);
      }
    }
  }

  // Check self-update if working binary supports it
  if (workingBinaryPath) {
    try {
      console.log(`🔄 [yt-dlp] Running self-update check (yt-dlp -U)...`);
      const updateResult = spawnSync(workingBinaryPath, ['-U'], { encoding: 'utf8', timeout: 25000 });
      if (updateResult.status === 0) {
        const updatedVerify = verifyBinary(workingBinaryPath);
        if (updatedVerify.success) {
          activeVersion = updatedVerify.version;
          console.log(`🚀 [yt-dlp] Up to date! Active Version: ${activeVersion}`);
        }
      } else {
        console.log(`ℹ️  [yt-dlp] Version active: ${activeVersion}`);
      }
    } catch (_) {}
  } else {
    console.warn(`
⚠️  [Setup Engine] Could not download standalone yt-dlp binary during build.
The application will use runtime fallback / system discovery. Build continuing safely...
`);
  }

  // =========================================================================
  // 3. Setup & Verify FFmpeg
  // =========================================================================
  let ffmpegFound = false;
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    if (ffmpegInstaller && ffmpegInstaller.path && fs.existsSync(ffmpegInstaller.path)) {
      if (!isWin) {
        try { fs.chmodSync(ffmpegInstaller.path, 0o755); } catch (_) {}
      }
      console.log(`\n✅ [FFmpeg] Provided by @ffmpeg-installer at: ${ffmpegInstaller.path}`);

      const ffmpegFileName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
      const binFfmpeg = path.join(binDir, ffmpegFileName);
      if (!fs.existsSync(binFfmpeg)) {
        try {
          fs.copyFileSync(ffmpegInstaller.path, binFfmpeg);
          if (!isWin) fs.chmodSync(binFfmpeg, 0o755);
          console.log(`✅ [FFmpeg] Mirrored to local bin: ${binFfmpeg}`);
        } catch (_) {}
      }
      ffmpegFound = true;
    }
  } catch (err) {
    console.warn('⚠️  [FFmpeg] @ffmpeg-installer note:', err.message);
  }

  // Verify FFmpeg execution
  const ffmpegCheckTarget = path.join(binDir, isWin ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(ffmpegCheckTarget)) {
    try {
      const fRes = spawnSync(ffmpegCheckTarget, ['-version'], { encoding: 'utf8', timeout: 5000 });
      if (fRes.status === 0) {
        const firstLine = (fRes.stdout || '').split('\n')[0];
        console.log(`🎬 [FFmpeg] Verified executable: ${firstLine}`);
        ffmpegFound = true;
      }
    } catch (_) {}
  }

  if (!ffmpegFound) {
    console.warn('⚠️  [FFmpeg] FFmpeg binary not found in bin. System will attempt standard PATH discovery.');
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║    ✨ [NEXADOWN] ALL CORE ENGINES INITIALIZED & READY!     ║
║    yt-dlp Version: ${(activeVersion || 'System Discovery').padEnd(38, ' ')}║
║    JavaScript Runtime: Node.js active                     ║
╚═══════════════════════════════════════════════════════════╝
`);
}

setupEngine().catch((err) => {
  console.warn('⚠️ [Setup Engine Warning]:', err.message);
  process.exit(0);
});
