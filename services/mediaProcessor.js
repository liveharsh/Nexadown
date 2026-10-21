/**
 * NEXADOWN - Production Media Processing & Job Management Engine
 * Handles FFmpeg conversions, yt-dlp extractions, concurrency control, and ephemeral file cleanup.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { NotFoundError, AppError } = require('../utils/errors');

const binDir = path.join(__dirname, '..', 'bin');
const tempDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const isWindows = process.platform === 'win32';
const ytdlpBinaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ffmpegBinaryName = isWindows ? 'ffmpeg.exe' : 'ffmpeg';

/**
 * Resolves ffmpeg executable path across Windows, macOS, and Linux (Render)
 */
function resolveFfmpegPath() {
  let p = path.join(binDir, ffmpegBinaryName);
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    if (ffmpegInstaller?.path && fs.existsSync(ffmpegInstaller.path)) {
      p = ffmpegInstaller.path;
    }
  } catch (_) {}

  // Check system PATH if not found in bin
  if (!fs.existsSync(p)) {
    const whichCmd = isWindows ? 'where' : 'which';
    try {
      const check = spawnSync(whichCmd, ['ffmpeg'], { encoding: 'utf8' });
      if (check.status === 0 && check.stdout.trim()) {
        p = check.stdout.trim().split('\n')[0].trim();
      }
    } catch (_) {}
  }

  // Ensure executable permissions on Linux / macOS
  if (!isWindows && fs.existsSync(p)) {
    try { fs.chmodSync(p, 0o755); } catch (_) {}
  }

  return p;
}

/**
 * Resolves yt-dlp executable path across platforms
 */
function resolveYtdlpPath() {
  const primary = path.join(binDir, ytdlpBinaryName);
  if (fs.existsSync(primary)) return primary;

  const altNames = ['yt-dlp.exe', 'yt-dlp', 'yt-dlp_linux', 'yt-dlp_macos'];
  for (const name of altNames) {
    const candidate = path.join(binDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Check system PATH
  const whichCmd = isWindows ? 'where' : 'which';
  try {
    const check = spawnSync(whichCmd, ['yt-dlp'], { encoding: 'utf8' });
    if (check.status === 0 && check.stdout.trim()) {
      return check.stdout.trim().split('\n')[0].trim();
    }
  } catch (_) {}

  return primary;
}

const ffmpegPath = resolveFfmpegPath();
const ytdlpPath = resolveYtdlpPath();

// Ensure permissions on Linux
if (!isWindows && fs.existsSync(ytdlpPath)) {
  try { fs.chmodSync(ytdlpPath, 0o755); } catch (_) {}
}

/**
 * Standard yt-dlp base arguments
 */
function getYtDlpBaseArgs() {
  const nodeBinary = process.execPath;
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    '--socket-timeout', '20',
    '--retries', '5',
    '--fragment-retries', '5',
    '--js-runtimes', `node:${nodeBinary}`,
    '--remote-components', 'ejs:github',
    '--extractor-args', 'youtube:player_client=android_embedded,web_embedded,android,web;player_skip=configs',
    '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language:en-US,en;q=0.9'
  ];
  // Auto-load YouTube Cookies from environment variable or cookies.txt file
  const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
  const tempCookiesPath = path.join(tempDir, 'cookies.txt');
  if (process.env.YOUTUBE_COOKIES && process.env.YOUTUBE_COOKIES.trim()) {
    try {
      fs.writeFileSync(tempCookiesPath, process.env.YOUTUBE_COOKIES.trim(), 'utf8');
      args.push('--cookies', tempCookiesPath);
    } catch (_) {}
  } else if (fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
  } else if (fs.existsSync(tempCookiesPath)) {
    args.push('--cookies', tempCookiesPath);
  }

  if (isWindows) {
    args.push('--windows-filenames');
  }
  return args;
}

/**
 * Concurrency & Job State Management
 */
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS, 10) || 4;
const activeJobs = new Map();
const jobQueue = [];

/**
 * Periodic sweep of stale jobs and temporary files (older than 15 minutes)
 */
setInterval(() => {
  const now = Date.now();
  const EXPIRATION_MS = 15 * 60 * 1000;

  for (const [id, job] of activeJobs.entries()) {
    if (now - job.createdAt > EXPIRATION_MS) {
      if (job.outputFile && fs.existsSync(job.outputFile)) {
        try { fs.unlinkSync(job.outputFile); } catch (_) {}
      }
      activeJobs.delete(id);
    }
  }
}, 3 * 60 * 1000).unref?.();

/**
 * Create a new processing job
 */
function createJob(params) {
  const jobId = uuidv4();
  const job = {
    id: jobId,
    url: params.url,
    type: params.type || 'video',
    height: params.height || 0,
    formatId: params.formatId || null,
    audioFormat: params.audioFormat || 'mp3',
    audioBitrate: params.audioBitrate || '320k',
    title: params.title || 'media',
    artist: params.artist || '',
    directUrl: params.directUrl || null,
    query: params.query || null,
    status: 'queued', // queued | processing | completed | failed | cancelled
    progress: 0,
    percentage: 0,
    speed: '0 KiB/s',
    size: '-- / --',
    eta: '--:--',
    message: 'Job queued...',
    outputFile: null,
    targetFilename: null,
    error: null,
    createdAt: Date.now(),
    childProcess: null
  };

  activeJobs.set(jobId, job);
  jobQueue.push(jobId);
  processQueue();

  return jobId;
}

/**
 * Returns public, sanitized job status
 */
function getJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return null;

  return {
    id: job.id,
    status: job.status,
    progress: job.percentage,
    percentage: job.percentage,
    speed: job.speed,
    size: job.size,
    eta: job.eta,
    message: job.message,
    error: job.error,
    complete: job.status === 'completed',
    targetFilename: job.targetFilename,
    downloadUrl: job.status === 'completed'
      ? `/api/download/file/${job.id}/${encodeURIComponent(job.targetFilename || 'download')}`
      : null,
    createdAt: new Date(job.createdAt).toISOString()
  };
}

/**
 * Cancels an active or queued job
 */
function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) {
    throw new NotFoundError('Job not found or already completed.', 'JOB_NOT_FOUND');
  }

  // If still queued, remove from queue
  const qIdx = jobQueue.indexOf(jobId);
  if (qIdx !== -1) {
    jobQueue.splice(qIdx, 1);
  }

  // Terminate child process if running
  if (job.childProcess) {
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', job.childProcess.pid.toString(), '/f', '/t']);
      } else {
        job.childProcess.kill('SIGTERM');
      }
    } catch (_) {}
  }

  job.status = 'cancelled';
  job.message = 'Job cancelled by user.';

  // Clean partial output file
  if (job.outputFile && fs.existsSync(job.outputFile)) {
    try { fs.unlinkSync(job.outputFile); } catch (_) {}
  }

  processQueue();
  return true;
}

/**
 * Remove job record
 */
function removeJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) {
    if (job.outputFile && fs.existsSync(job.outputFile)) {
      try { fs.unlinkSync(job.outputFile); } catch (_) {}
    }
    activeJobs.delete(jobId);
  }
}

/**
 * Count active processing jobs
 */
function getActiveCount() {
  let count = 0;
  for (const job of activeJobs.values()) {
    if (job.status === 'processing') count++;
  }
  return count;
}

/**
 * Queue processor
 */
function processQueue() {
  while (getActiveCount() < MAX_CONCURRENT_JOBS && jobQueue.length > 0) {
    const nextJobId = jobQueue.shift();
    const job = activeJobs.get(nextJobId);
    if (job && job.status === 'queued') {
      executeJob(job);
    }
  }
}

/**
 * Executes a single download/processing job
 */
function executeJob(job) {
  job.status = 'processing';
  job.message = 'Starting extraction engine...';

  const ext = job.type === 'audio' ? (job.audioFormat || 'mp3') : 'mp4';
  const safeTitle = (job.title || 'media').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
  job.targetFilename = `${safeTitle}.${ext}`;

  const tempFilename = `job_${job.id}_${Date.now()}.${ext}`;
  const outputPath = path.join(tempDir, tempFilename);
  job.outputFile = outputPath;

  const ytdlpArgs = [...getYtDlpBaseArgs()];

  if (fs.existsSync(ffmpegPath)) {
    ytdlpArgs.push('--ffmpeg-location', ffmpegPath);
  }

  // Format selection
  if (job.type === 'audio') {
    ytdlpArgs.push(
      '-x',
      '--audio-format', job.audioFormat || 'mp3',
      '--audio-quality', job.audioBitrate || '320k',
      '--embed-thumbnail',
      '--convert-thumbnails', 'jpg',
      '--add-metadata',
      '--postprocessor-args', 'ffmpeg:-strict -2 -threads 0'
    );
  } else {
    // Video - Prioritize MP4 container compatible streams and allow experimental opus muxing
    ytdlpArgs.push('--postprocessor-args', 'ffmpeg:-strict -2 -threads 0');
    if (job.height && job.height > 0) {
      ytdlpArgs.push(
        '-f', `bestvideo*[height<=${job.height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo*[height<=${job.height}]+bestaudio/best[height<=${job.height}]/best`,
        '--merge-output-format', 'mp4'
      );
    } else {
      ytdlpArgs.push(
        '-f', 'bestvideo*[ext=mp4]+bestaudio[ext=m4a]/bestvideo*+bestaudio/best',
        '--merge-output-format', 'mp4'
      );
    }
  }

  let downloadTarget = job.url;
  if (job.query) {
    downloadTarget = `ytsearch1:${job.query}`;
  } else if (job.url && (job.url.includes('spotify.com') || job.url.includes('spotify.link'))) {
    const cleanSearch = `${job.title || 'Music Track'} ${job.artist || ''}`.replace(/[^\w\s]/gi, ' ').trim();
    downloadTarget = `ytsearch1:${cleanSearch}`;
  }

  if (downloadTarget.startsWith('ytsearch')) {
    ytdlpArgs.push('--playlist-items', '1');
  }

  ytdlpArgs.push('-o', outputPath, downloadTarget);

  console.log(`[Job ${job.id}] Executing: ${ytdlpPath} ${ytdlpArgs.slice(0, 8).join(' ')} ...`);

  const child = spawn(ytdlpPath, ytdlpArgs);
  job.childProcess = child;

  let stderrBuffer = '';

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    parseProgress(job, text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    parseProgress(job, text);
  });

  child.on('close', (code) => {
    job.childProcess = null;

    if (job.status === 'cancelled') {
      processQueue();
      return;
    }

    let finalPath = outputPath;
    if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1024) {
      try {
        const files = fs.readdirSync(tempDir);
        const match = files.find(f => (f.startsWith(`job_${job.id}`) || f.startsWith(job.id)) && (f.endsWith('.mp4') || f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.webm') || f.endsWith('.mkv')));
        if (match) {
          const mPath = path.join(tempDir, match);
          if (fs.existsSync(mPath) && fs.statSync(mPath).size > 1024) {
            finalPath = mPath;
            job.outputFile = mPath;
          }
        }
      } catch (_) {}
    }

    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1024) {
      job.status = 'completed';
      job.percentage = 100;
      job.complete = true;
      job.message = 'Download ready!';
      console.log(`[Job ${job.id}] Completed: ${finalPath}`);
    } else {
      job.status = 'failed';
      job.error = classifyMediaError(stderrBuffer, code);
      job.message = `Processing failed: ${job.error}`;
      console.error(`[Job ${job.id}] Failed with code ${code}: ${job.error}`);
    }

    processQueue();
  });

  child.on('error', (err) => {
    job.childProcess = null;
    job.status = 'failed';
    job.error = err.message;
    job.message = `Engine process error: ${err.message}`;
    processQueue();
  });
}

/**
 * Parses progress output from yt-dlp stdout
 */
function parseProgress(job, text) {
  // [download]  45.2% of  120.45MiB at  2.45MiB/s ETA 00:27
  const pctMatch = text.match(/(\d{1,3}(?:\.\d+)?)%/);
  if (pctMatch) {
    const p = parseFloat(pctMatch[1]);
    job.percentage = Math.min(99, Math.max(0, Math.round(p)));
    job.progress = job.percentage;
  }

  const speedMatch = text.match(/at\s+([\d.]+\s*[KMGT]?i?B\/s)/i);
  if (speedMatch) {
    job.speed = speedMatch[1];
  }

  const sizeMatch = text.match(/of\s+~?([\d.]+\s*[KMGT]?i?B)/i);
  if (sizeMatch) {
    job.size = sizeMatch[1];
  }

  const etaMatch = text.match(/ETA\s+(\d{2}:\d{2}(?::\d{2})?)/i);
  if (etaMatch) {
    job.eta = etaMatch[1];
  }

  if (text.includes('[download]')) {
    job.message = 'Downloading media stream...';
  } else if (text.includes('[ExtractAudio]') || text.includes('[Merger]')) {
    job.message = 'Processing and embedding audio/subtitles...';
  }
}

/**
 * Classifies yt-dlp errors into user-friendly messages
 */
function classifyMediaError(stderr, code) {
  const lower = (stderr || '').toLowerCase();
  if (lower.includes('private video')) return 'This media is private and requires authorization.';
  if (lower.includes('unavailable') || lower.includes('removed')) return 'This media is unavailable or was removed.';
  if (lower.includes('confirm your age') || lower.includes('age-restricted') || lower.includes('inappropriate for some users')) return 'This video is age-restricted by YouTube. Sign-in cookies are required to download it.';
  if (lower.includes('bot') || lower.includes('confirm you') || lower.includes('sign in')) return 'YouTube rate limit or bot check on datacenter IP. Please retry or provide cookies.txt.';
  if (lower.includes('copyright')) return 'Blocked due to copyright restrictions.';
  if (lower.includes('bot') || lower.includes('player response')) return 'Platform rate limit encountered. Please wait a few moments and retry.';
  return 'Media extraction failed. Check if link is public and accessible.';
}

/**
 * Extract metadata JSON safely
 */
async function extractMetadata(url) {
  return new Promise((resolve, reject) => {
    const args = [
      ...getYtDlpBaseArgs(),
      '--dump-json',
      '--skip-download',
      url
    ];

    const child = spawn(ytdlpPath, args);
    let stdoutData = '';
    let stderrData = '';

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new AppError('Metadata extraction timed out.', 504, 'TIMEOUT'));
    }, 45000);

    child.stdout.on('data', chunk => { stdoutData += chunk.toString(); });
    child.stderr.on('data', chunk => { stderrData += chunk.toString(); });

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && stdoutData.trim()) {
        try {
          const json = JSON.parse(stdoutData.trim().split('\n')[0]);
          resolve(json);
        } catch (e) {
          reject(new AppError('Failed to parse media metadata response.', 500, 'PARSE_ERROR'));
        }
      } else {
        const msg = classifyMediaError(stderrData, code);
        reject(new AppError(msg, 400, 'EXTRACT_FAILED'));
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(new AppError(`Extractor engine failure: ${err.message}`, 500, 'ENGINE_ERROR'));
    });
  });
}

/**
 * Direct file streaming utility
 */
function makeContentDisposition(filename) {
  try {
    const cd = require('content-disposition');
    return cd(filename, { type: 'attachment' });
  } catch (_) {
    const safeAscii = (filename || 'download').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(filename || 'download').replace(/['()]/g, escape).replace(/\*/g, '%2A');
    return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
  }
}

function streamJobFile(jobId, req, res) {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'completed' || !job.outputFile) {
    throw new NotFoundError('Download file is not ready or has expired.', 'FILE_NOT_READY');
  }

  if (!fs.existsSync(job.outputFile)) {
    throw new NotFoundError('Processed media file not found on disk.', 'FILE_NOT_FOUND');
  }

  const stat = fs.statSync(job.outputFile);
  const rawFilename = job.targetFilename || path.basename(job.outputFile);
  const ext = path.extname(rawFilename).toLowerCase();

  const mimeMap = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.zip': 'application/zip',
    '.srt': 'text/plain; charset=utf-8'
  };

  const contentType = mimeMap[ext] || 'application/octet-stream';

  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', makeContentDisposition(rawFilename));

  const stream = fs.createReadStream(job.outputFile);
  stream.pipe(res);

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    setTimeout(() => {
      try {
        if (fs.existsSync(job.outputFile)) {
          fs.unlinkSync(job.outputFile);
        }
      } catch (_) {}
      activeJobs.delete(jobId);
    }, 2000);
  };

  res.on('finish', cleanup);
  req.on('close', () => {
    if (!res.writableEnded) {
      stream.destroy();
      cleanup();
    }
  });
}

module.exports = {
  createJob,
  getJob,
  cancelJob,
  removeJob,
  extractMetadata,
  streamJobFile,
  ffmpegPath,
  ytdlpPath,
  MAX_CONCURRENT_JOBS,
  activeJobs
};
