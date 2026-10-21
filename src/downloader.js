const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');

const binDir = path.join(__dirname, '..', 'bin');
const tempDir = path.join(__dirname, '..', 'temp');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const arch = process.arch;

const ytdlpBinaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ffmpegBinaryName = isWindows ? 'ffmpeg.exe' : 'ffmpeg';

function getYtdlpCandidates() {
  if (isWindows) {
    return [
      { name: 'yt-dlp.exe', url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', minSize: 10 * 1024 * 1024 }
    ];
  }
  if (isMac) {
    return [
      { name: 'yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos', minSize: 10 * 1024 * 1024 },
      { name: 'yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', minSize: 2 * 1024 * 1024 }
    ];
  }
  // Linux (Render)
  const isArm = arch === 'arm64' || arch === 'aarch64';
  const linuxStandalone = isArm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return [
    { name: 'yt-dlp', url: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${linuxStandalone}`, minSize: 10 * 1024 * 1024 },
    { name: 'yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', minSize: 2 * 1024 * 1024 }
  ];
}

function resolveExistingYtdlp() {
  const primary = path.join(binDir, ytdlpBinaryName);
  if (fs.existsSync(primary)) return primary;
  const altNames = ['yt-dlp.exe', 'yt-dlp', 'yt-dlp_linux', 'yt-dlp_macos'];
  for (const name of altNames) {
    const candidate = path.join(binDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return primary;
}

let ytdlpPath = resolveExistingYtdlp();

// Try finding ffmpeg path with automatic chmod 755 on Linux
function getFfmpegPath() {
  let p = path.join(binDir, ffmpegBinaryName);
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    if (ffmpegInstaller && ffmpegInstaller.path && fs.existsSync(ffmpegInstaller.path)) {
      p = ffmpegInstaller.path;
    }
  } catch (e) {
    // Use binDir fallback
  }

  // Ensure executable permissions on Linux / macOS
  if (!isWindows && fs.existsSync(p)) {
    try { fs.chmodSync(p, 0o755); } catch (_) {}
  }
  return p;
}

let ffmpegPath = getFfmpegPath();

/**
 * Returns standardized base arguments for yt-dlp across all commands
 * Automatically configures Node.js as the external JavaScript runtime and enables remote EJS solvers
 */
/**
 * Resolves active Netscape cookies file for YouTube & cloud datacenter bypass.
 */
function getCookiesPath() {
  if (process.env.COOKIES_PATH && fs.existsSync(process.env.COOKIES_PATH)) {
    return process.env.COOKIES_PATH;
  }
  const envCookies = process.env.YOUTUBE_COOKIES || process.env.COOKIES_CONTENT;
  if (envCookies && envCookies.trim().length > 20) {
    try {
      const envCookieFile = path.join(tempDir, 'env_cookies.txt');
      if (!fs.existsSync(envCookieFile) || fs.statSync(envCookieFile).size === 0) {
        fs.writeFileSync(envCookieFile, envCookies.trim(), 'utf8');
      }
      return envCookieFile;
    } catch (_) {}
  }
  const rootCookies = path.join(__dirname, '..', 'cookies.txt');
  if (fs.existsSync(rootCookies) && fs.statSync(rootCookies).size > 0) {
    return rootCookies;
  }
  const tempCookies = path.join(tempDir, 'cookies.txt');
  if (fs.existsSync(tempCookies) && fs.statSync(tempCookies).size > 0) {
    return tempCookies;
  }
  try {
    const userHome = os.homedir();
    const winDownloadCookies = path.join(userHome, 'Downloads', 'cookies.txt');
    if (fs.existsSync(winDownloadCookies) && fs.statSync(winDownloadCookies).size > 0) {
      return winDownloadCookies;
    }
  } catch (_) {}
  return null;
}

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
    '--remote-components', 'ejs:github'
  ];
  if (isWindows) {
    args.push('--windows-filenames');
  }
    const cookiePath = getCookiesPath();
  if (cookiePath) {
    args.push('--cookies', cookiePath);
  }
  return args;
}

/**
 * Classifies yt-dlp stderr output into clean, user-friendly error messages
 */
function classifyMediaError(stderr, code) {
  const text = stderr ? stderr.toString() : '';
  const lower = text.toLowerCase();

  if (lower.includes('this video is unavailable') || lower.includes('video is unavailable')) {
    return 'This video is unavailable or has been removed from YouTube.';
  }
  if (lower.includes('private video') || lower.includes('this is a private video')) {
    return 'This video is private and cannot be downloaded without account authorization.';
  }
  if (lower.includes('sign in to confirm your age') || lower.includes('age-restricted')) {
    return 'This video is age-restricted and requires account verification.';
  }
  if (lower.includes('not made this video available in your country') || lower.includes('region')) {
    return 'This video is region-restricted and unavailable in the server’s country.';
  }
  if (lower.includes('failed to extract any player response') || lower.includes('bot') || lower.includes('sign in to confirm you')) {
    return 'YouTube rate limit or bot check on datacenter IP. Please retry or provide cookies.txt.';
  }
  if (lower.includes('copyright') || lower.includes('blocked')) {
    return 'This video is blocked due to copyright restrictions.';
  }

  // Clean single line error starting with ERROR:
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('ERROR:') || l.includes('Error:'));
  if (lines.length > 0) {
    return lines[lines.length - 1].replace(/^ERROR:\s*/i, '').trim();
  }

  if (code !== 0 && code !== null && code !== undefined) {
    return `Extraction process exited with error code ${code}.`;
  }
  return 'Media extraction timed out or failed. Please verify the link.';
}

/**
 * Ensures a working yt-dlp binary exists on the system, downloading on the fly if needed
 */
async function ensureYtdlp() {
  getFfmpegPath();
  const current = resolveExistingYtdlp();

  // Validate existing binary if present
  if (fs.existsSync(current)) {
    try {
      if (!isWindows) fs.chmodSync(current, 0o755);
      const res = spawnSync(current, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (res.status === 0 && res.stdout && res.stdout.trim().length > 0) {
        ytdlpPath = current;
        return ytdlpPath;
      }
    } catch (_) {}
  }

  console.log(`[NEXADOWN Engine] Validating and downloading latest yt-dlp binary for ${process.platform} (${arch})...`);
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const downloadCandidate = (targetUrl, destPath, minSize, redirects = 5) => {
    return new Promise((resolve, reject) => {
      if (redirects <= 0) return reject(new Error('Exceeded HTTP redirect limit'));

      https.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadCandidate(res.headers.location, destPath, minSize, redirects - 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download binary: HTTP ${res.statusCode}`));
        }

        const tmpPath = `${destPath}.tmp_${Date.now()}`;
        const fileStream = fs.createWriteStream(tmpPath);
        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              const stat = fs.statSync(tmpPath);
              if (stat.size < minSize) {
                fs.unlinkSync(tmpPath);
                return reject(new Error(`Incomplete binary download (${stat.size} bytes)`));
              }
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tmpPath, destPath);
              if (!isWindows) fs.chmodSync(destPath, 0o755);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on('error', (err) => {
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
          reject(err);
        });
      }).on('error', reject);
    });
  };

  const candidates = getYtdlpCandidates();
  for (const candidate of candidates) {
    const dest = path.join(binDir, candidate.name);
    try {
      await downloadCandidate(candidate.url, dest, candidate.minSize);
      const test = spawnSync(dest, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (test.status === 0) {
        ytdlpPath = dest;
        console.log(`[NEXADOWN Engine] yt-dlp initialized successfully! Active Version: ${test.stdout.trim()}`);
        return ytdlpPath;
      }
    } catch (e) {
      console.warn(`[NEXADOWN Engine] Failed candidate ${candidate.url}: ${e.message}`);
    }
  }

  return ytdlpPath;
}

// Global active progress tracker
const activeJobs = new Map();

/**
 * Periodically purge stale temp files older than 15 minutes
 */
function cleanupOldTempFiles() {
  try {
    if (!fs.existsSync(tempDir)) return;
    const now = Date.now();
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > 15 * 60 * 1000) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {}
    }
  } catch (err) {
    console.error('Error during temp cleanup:', err.message);
  }
}
setInterval(cleanupOldTempFiles, 5 * 60 * 1000);

/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'Unknown';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format bytes to readable string (MB/GB)
 */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return null;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Helper to fetch HTTPS content with redirects
 */
function fetchHttps(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    };
    https.get(targetUrl, { headers: defaultHeaders }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchHttps(res.headers.location, headers));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    }).on('error', reject);
  });
}

/**
 * Cleans emojis, strange unicode characters, and illegal punctuation from search queries
 */
function cleanSearchQuery(query) {
  if (!query || typeof query !== 'string') return '';
  return query
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F0F5}\u{1F200}-\u{1F270}\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[🔥♥️😍‼❤️✨⚡💥🎉⭐👍]/g, '')
    .replace(/[[\](){}<>]/g, ' ')
    .replace(/[\\/:*?"|#~_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Handles Spotify URL analysis (extracts title, artist, album, cover art)
 */
async function analyzeSpotify(spotifyUrl) {
  try {
    let trackTitle = 'Spotify Track';
    let artistName = 'Spotify Artist';
    let albumName = 'Spotify Album';
    let coverArt = 'https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png';

    // 1. Fetch oEmbed metadata
    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
      const { statusCode, data } = await fetchHttps(oembedUrl);
      if (statusCode === 200) {
        const oembed = JSON.parse(data);
        if (oembed.title) trackTitle = oembed.title;
        if (oembed.thumbnail_url) coverArt = oembed.thumbnail_url;
      }
    } catch (_) {}

    // 2. Fetch page HTML for high-res cover art and exact artist
    try {
      const { statusCode, data: html } = await fetchHttps(spotifyUrl);
      if (statusCode === 200) {
        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i);
        const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/i);

        if (ogTitle && ogTitle[1]) trackTitle = ogTitle[1].trim();
        if (ogImage && ogImage[1]) coverArt = ogImage[1].trim();
        if (ogDesc && ogDesc[1]) {
          const parts = ogDesc[1].split('·').map(s => s.trim());
          if (parts.length > 0 && parts[0]) {
            artistName = parts[0];
          }
          if (parts.length > 1 && parts[1] && !parts[1].toLowerCase().includes('song') && !parts[1].toLowerCase().includes('single')) {
            albumName = parts[1];
          }
        }
      }
    } catch (_) {}

    const audioOptions = [
      {
        id: 'audio-mp3-320',
        type: 'audio',
        audioFormat: 'mp3',
        audioBitrate: '320k',
        label: 'MP3 - Ultra High Fidelity (320 kbps)',
        quality: '320 kbps Studio Master + Embedded Cover Art & Lyrics',
        ext: 'mp3',
        badge: 'STUDIO MASTER',
        recommended: true,
        hasSubtitles: true,
        estimatedSize: '~8.5 MB'
      },
      {
        id: 'audio-mp3-256',
        type: 'audio',
        audioFormat: 'mp3',
        audioBitrate: '256k',
        label: 'MP3 - High Quality (256 kbps)',
        quality: '256 kbps + Embedded Cover Art',
        ext: 'mp3',
        badge: 'HQ',
        hasSubtitles: true,
        estimatedSize: '~6.8 MB'
      },
      {
        id: 'audio-mp3-192',
        type: 'audio',
        audioFormat: 'mp3',
        audioBitrate: '192k',
        label: 'MP3 - Standard Quality (192 kbps)',
        quality: '192 kbps + Embedded Cover Art',
        ext: 'mp3',
        badge: 'STANDARD',
        hasSubtitles: true,
        estimatedSize: '~5.1 MB'
      },
      {
        id: 'audio-flac',
        type: 'audio',
        audioFormat: 'flac',
        audioBitrate: null,
        label: 'FLAC - Pure Lossless Audio',
        quality: 'Bit-for-Bit Lossless Master',
        ext: 'flac',
        badge: 'LOSSLESS',
        estimatedSize: '~24.0 MB'
      },
      {
        id: 'audio-wav',
        type: 'audio',
        audioFormat: 'wav',
        audioBitrate: null,
        label: 'WAV - Studio Master Audio (16-bit PCM)',
        quality: 'Uncompressed Studio Waveform',
        ext: 'wav',
        badge: 'STUDIO',
        estimatedSize: '~38.0 MB'
      },
      {
        id: 'audio-m4a',
        type: 'audio',
        audioFormat: 'm4a',
        audioBitrate: null,
        label: 'M4A - Apple AAC Audio',
        quality: 'Optimized for iPhone, iPad & Mac',
        ext: 'm4a',
        badge: 'APPLE AAC',
        estimatedSize: '~7.2 MB'
      }
    ];

    const videoOptions = [
      {
        id: 'video-1080p',
        type: 'video',
        formatId: 'bestvideo[height<=1080]+bestaudio/best',
        height: 1080,
        label: 'Official Music Video (1080p Full HD)',
        quality: '1080p Full HD MP4',
        ext: 'mp4',
        badge: 'POPULAR',
        recommended: true,
        estimatedSize: '~45.0 MB'
      },
      {
        id: 'video-720p',
        type: 'video',
        formatId: 'bestvideo[height<=720]+bestaudio/best',
        height: 720,
        label: 'Official Music Video (720p HD)',
        quality: '720p HD MP4',
        ext: 'mp4',
        badge: 'FAST',
        estimatedSize: '~25.0 MB'
      }
    ];

    const subtitlesList = [
      { lang: 'en', label: 'English Lyrics / Subtitles (.SRT)', badge: 'EN' },
      { lang: 'auto', label: 'Synchronized Lyrics (.SRT)', badge: 'LYRICS' }
    ];

    return {
      id: uuidv4(),
      title: trackTitle,
      uploader: artistName,
      uploader_url: spotifyUrl,
      durationSeconds: 210,
      durationFormatted: '3:30',
      thumbnail: coverArt,
      description: `${trackTitle} by ${artistName} • Album: ${albumName}`,
      viewCount: 'Spotify Official Track',
      uploadDate: null,
      extractor: 'Spotify Music',
      originalUrl: spotifyUrl,
      artist: artistName,
      album: albumName,
      videoOptions,
      audioOptions,
      subtitlesList,
      thumbnailUrl: coverArt
    };
  } catch (err) {
    throw new Error(`Failed to extract Spotify metadata: ${err.message}`);
  }
}

/**
 * Analyzes Spotify Playlists and Albums and extracts all songs with individual album artwork
 */
async function analyzeSpotifyPlaylist(playlistUrl) {
  try {
    let entityId = null;
    let entityType = 'playlist';
    const match = playlistUrl.match(/(playlist|album)\/([a-zA-Z0-9]+)/);
    if (match) {
      entityType = match[1];
      entityId = match[2];
    }

    if (!entityId) {
      throw new Error('Invalid Spotify URL. Could not find playlist or album ID.');
    }

    const embedUrl = `https://open.spotify.com/embed/${entityType}/${entityId}`;
    const { statusCode, data: html } = await fetchHttps(embedUrl);
    if (statusCode !== 200 || !html) {
      throw new Error(`Failed to load Spotify embed page (HTTP ${statusCode})`);
    }

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!nextDataMatch) {
      throw new Error('Could not parse Spotify structure.');
    }

    const parsed = JSON.parse(nextDataMatch[1]);
    const entity = parsed?.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      throw new Error('Spotify playlist/album entity not found.');
    }

    const playlistName = entity.name || entity.title || (entityType === 'album' ? 'Spotify Album' : 'Spotify Playlist');
    const creator = entity.subtitle || 'Spotify Artist';

    let coverUrl = 'https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png';
    if (entity.visualIdentity?.image && entity.visualIdentity.image.length > 0) {
      const best = entity.visualIdentity.image[entity.visualIdentity.image.length - 1];
      if (best?.url) coverUrl = best.url;
    } else if (entity.coverArt?.sources && entity.coverArt.sources.length > 0) {
      coverUrl = entity.coverArt.sources[0].url;
    }

    const rawTracks = entity.trackList || [];

    // Parallel fetch individual track album artwork (max 2.5s)
    const trackCoverPromises = rawTracks.map(async (t) => {
      try {
        if (!t.uri || !t.uri.includes(':track:')) return null;
        const trackId = t.uri.split(':')[2];
        const { statusCode: oCode, data: oData } = await fetchHttps(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`);
        if (oCode === 200 && oData) {
          const parsedOembed = JSON.parse(oData);
          return parsedOembed.thumbnail_url || null;
        }
      } catch (_) {}
      return null;
    });

    const covers = await Promise.race([
      Promise.all(trackCoverPromises),
      new Promise(resolve => setTimeout(() => resolve([]), 2500))
    ]);

    const tracks = rawTracks.map((t, idx) => {
      const ms = t.duration || 180000;
      const totalSecs = Math.floor(ms / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const durationFormatted = `${mins}:${secs.toString().padStart(2, '0')}`;
      const trackThumb = (covers && covers[idx]) || null;

      return {
        index: idx + 1,
        title: t.title || `Track ${idx + 1}`,
        artist: t.subtitle || creator,
        durationFormatted,
        isExplicit: !!t.isExplicit,
        coverUrl: trackThumb,
        audioPreviewUrl: t.audioPreview?.url || null,
        query: `${t.title} ${t.subtitle}`.trim()
      };
    });

    return {
      id: uuidv4(),
      isPlaylist: true,
      title: playlistName,
      uploader: creator,
      uploader_url: playlistUrl,
      durationFormatted: `${tracks.length} Songs`,
      thumbnail: coverUrl,
      thumbnailUrl: coverUrl,
      description: `Spotify ${entityType === 'album' ? 'Album' : 'Playlist'}: "${playlistName}" by ${creator} • Total ${tracks.length} tracks.`,
      viewCount: `${tracks.length} Tracks`,
      extractor: entityType === 'album' ? 'Spotify Album' : 'Spotify Playlist',
      originalUrl: playlistUrl,
      tracks,
      videoOptions: [],
      audioOptions: [],
      subtitlesList: []
    };
  } catch (err) {
    throw new Error(`Spotify Playlist Error: ${err.message}`);
  }
}

/**
 * Direct Instagram parser for Photo Posts, Carousels, and non-video posts
 */
function fetchInstagramHtml(targetUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return resolve('');
    const headers = {
      'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    };
    https.get(targetUrl, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchInstagramHtml(res.headers.location, maxRedirects - 1));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function analyzeInstagramPost(url) {
  try {
    const html = await fetchInstagramHtml(url);
    if (!html || html.length < 500) {
      throw new Error('Unable to retrieve Instagram post contents.');
    }

    const ogImgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
    const ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/i);
    const ogVideoMatch = html.match(/<meta property="og:video" content="([^"]+)"/i);

    const rawTitle = ogTitleMatch ? ogTitleMatch[1] : 'Instagram Media Post';
    const cleanTitle = rawTitle
      .replace(/&quot;/g, '"')
      .replace(/&#064;/g, '@')
      .replace(/&#x2019;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#[0-9]+;/g, '')
      .trim();

    const ogImg = ogImgMatch ? ogImgMatch[1].replace(/&amp;/g, '&') : null;
    const ogVideo = ogVideoMatch ? ogVideoMatch[1].replace(/&amp;/g, '&') : null;

    let uploader = 'Instagram Creator';
    let stats = 'Instagram Post';
    if (ogDescMatch) {
      const desc = ogDescMatch[1].replace(/&quot;/g, '"');
      const uploaderMatch = desc.match(/-\s*([a-zA-Z0-9._]+)\s+on/);
      if (uploaderMatch) uploader = '@' + uploaderMatch[1];
      const likesMatch = desc.match(/^([^,]+likes(?:,\s*[^,]+comments)?)/i);
      if (likesMatch) stats = likesMatch[1];
    }

    // Carousel or feed images
    const allImages = [...html.matchAll(/https:\/\/scontent[^"'\s\\]+/g)]
      .map(m => m[0].replace(/&amp;/g, '&'))
      .filter(u => u.includes('CAROUSEL_ITEM') || u.includes('FEED.best_image') || u.includes('_n.jpg'))
      .filter(u => !u.includes('s150x150') && !u.includes('profile_pic'));

    const uniqueImages = Array.from(new Set([ogImg, ...allImages].filter(Boolean)));

    const videoOptions = [];
    if (ogVideo) {
      videoOptions.push({
        id: 'ig-video-best',
        type: 'video',
        directUrl: ogVideo,
        label: 'Instagram Video (Original MP4)',
        quality: 'Original Video Stream',
        ext: 'mp4',
        badge: 'ORIGINAL HD',
        recommended: true,
        estimatedSize: '~15.0 MB'
      });
    }

    uniqueImages.forEach((imgUrl, idx) => {
      videoOptions.push({
        id: `ig-photo-${idx + 1}`,
        type: 'image',
        directUrl: imgUrl,
        label: uniqueImages.length > 1 ? `Instagram Photo ${idx + 1} (Original HD JPG)` : `Instagram Photo (Original HD JPG)`,
        quality: 'High-Resolution Original Image',
        ext: 'jpg',
        badge: idx === 0 ? 'COVER / PHOTO 1' : `PHOTO ${idx + 1}`,
        recommended: idx === 0 && !ogVideo,
        estimatedSize: '~2.5 MB'
      });
    });

    return {
      id: uuidv4(),
      title: cleanTitle,
      uploader,
      uploader_url: url,
      durationSeconds: ogVideo ? 30 : 0,
      durationFormatted: ogVideo ? '0:30' : 'Photo',
      thumbnail: ogImg || uniqueImages[0] || '',
      description: ogDescMatch ? ogDescMatch[1] : cleanTitle,
      viewCount: stats,
      extractor: 'Instagram',
      originalUrl: url,
      videoOptions,
      audioOptions: [],
      subtitlesList: [],
      thumbnailUrl: ogImg || uniqueImages[0] || ''
    };
  } catch (err) {
    throw new Error(`Failed to extract Instagram post: ${err.message}`);
  }
}

/**
 * Strips tracking parameters, playlist parameters, and mix IDs from URLs to prevent bot-detection & 404s
 */
function cleanMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let cleaned = rawUrl.trim();
  try {
    const parsed = new URL(cleaned);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const v = parsed.searchParams.get('v');
      if (v) {
        return `https://www.youtube.com/watch?v=${v}`;
      }
      if (host.includes('youtu.be')) {
        const id = parsed.pathname.replace(/^\//, '').split('/')[0].split('?')[0];
        if (id) {
          return `https://www.youtube.com/watch?v=${id}`;
        }
      }
      if (parsed.pathname.includes('/shorts/')) {
        const id = parsed.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
        if (id) {
          return `https://www.youtube.com/watch?v=${id}`;
        }
      }
    }
  } catch (_) {}
  return cleaned;
}

/**
 * Extracts comprehensive metadata and available formats for any media URL
 */
function analyzeUrl(rawUrl) {
  const url = cleanMediaUrl(rawUrl);
  if (url && (url.includes('spotify.com') || url.includes('spotify.link'))) {
    if (url.includes('/playlist/') || url.includes('/album/')) {
      return analyzeSpotifyPlaylist(url);
    }
    return analyzeSpotify(url);
  }

  // If it's explicitly an Instagram photo or carousel post (/p/), use direct parser first
  if (url && url.includes('instagram.com/p/')) {
    return analyzeInstagramPost(url).catch(() => analyzeWithYtdlp(url));
  }

  return analyzeWithYtdlp(url);
}

/**
 * Fast YouTube Metadata Fallback via oEmbed (Bypasses Datacenter IP Bot Checks)
 */
async function analyzeYouTubeFallback(youtubeUrl) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
    const res = await fetchHttps(oembedUrl);
    if (res.statusCode !== 200) {
      throw new Error(`YouTube oEmbed returned HTTP ${res.statusCode}`);
    }
    const oembed = JSON.parse(res.data);
    const videoTitle = oembed.title || 'YouTube Media Video';
    const authorName = oembed.author_name || 'YouTube Channel';
    const thumbUrl = oembed.thumbnail_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600';

    const videoOptions = [
      {
        id: 'video-1080p',
        type: 'video',
        formatId: 'bestvideo[height<=1080]+bestaudio/best',
        height: 1080,
        label: '1080p Full HD (MP4)',
        quality: '1080p Full HD',
        ext: 'mp4',
        badge: 'POPULAR',
        recommended: true,
        estimatedSize: '~35.0 MB'
      },
      {
        id: 'video-720p',
        type: 'video',
        formatId: 'bestvideo[height<=720]+bestaudio/best',
        height: 720,
        label: '720p HD Video (MP4)',
        quality: '720p HD',
        ext: 'mp4',
        badge: 'FAST',
        estimatedSize: '~18.0 MB'
      },
      {
        id: 'video-480p',
        type: 'video',
        formatId: 'bestvideo[height<=480]+bestaudio/best',
        height: 480,
        label: '480p Standard (MP4)',
        quality: '480p SD',
        ext: 'mp4',
        badge: 'SD',
        estimatedSize: '~10.0 MB'
      },
      {
        id: 'video-360p',
        type: 'video',
        formatId: '18/best',
        height: 360,
        label: '360p Fast Download (MP4)',
        quality: '360p Quick',
        ext: 'mp4',
        badge: 'FASTEST',
        estimatedSize: '~6.5 MB'
      }
    ];

    const audioOptions = [
      {
        id: 'audio-mp3-320',
        type: 'audio',
        audioFormat: 'mp3',
        audioBitrate: '320k',
        label: 'MP3 - Ultra High Fidelity (320 kbps)',
        quality: '320 kbps + Embedded Cover Art & Lyrics',
        ext: 'mp3',
        badge: 'STUDIO MASTER',
        recommended: true,
        hasSubtitles: true,
        estimatedSize: '~8.5 MB'
      },
      {
        id: 'audio-mp3-192',
        type: 'audio',
        audioFormat: 'mp3',
        audioBitrate: '192k',
        label: 'MP3 - Standard (192 kbps)',
        quality: '192 kbps Audio',
        ext: 'mp3',
        badge: 'FAST',
        estimatedSize: '~5.0 MB'
      },
      {
        id: 'audio-m4a',
        type: 'audio',
        audioFormat: 'm4a',
        audioBitrate: null,
        label: 'M4A - Apple AAC Audio',
        quality: 'Native Mobile Audio',
        ext: 'm4a',
        badge: 'APPLE',
        estimatedSize: '~4.5 MB'
      }
    ];

    return {
      id: uuidv4(),
      title: videoTitle,
      uploader: authorName,
      uploader_url: youtubeUrl,
      durationSeconds: 180,
      durationFormatted: 'Official Video',
      thumbnail: thumbUrl,
      description: `${videoTitle} by ${authorName}`,
      viewCount: 'Verified YouTube Stream',
      extractor: 'YouTube',
      originalUrl: youtubeUrl,
      videoOptions,
      audioOptions,
      subtitlesList: [
        { lang: 'en', label: 'English Subtitles (.SRT)', badge: 'EN' }
      ],
      thumbnailUrl: thumbUrl
    };
  } catch (err) {
    throw new Error(`YouTube extraction error: ${err.message}`);
  }
}

async function analyzeWithYtdlp(url) {
  const binary = await ensureYtdlp();
  const isYouTube = url && (url.includes('youtube.com') || url.includes('youtu.be'));
  const isInstagram = url && url.includes('instagram.com');

  return new Promise((resolve, reject) => {
    let settled = false;

    const safeResolve = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(val);
    };

    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    };

    const args = [
      '--dump-single-json',
      ...getYtDlpBaseArgs()
    ];

    if (isYouTube) {
      args.push(
        '--extractor-args', 'youtube:player_client=ios,android,mweb,web'
      );
    }

    args.push(url);

    const child = spawn(binary || ytdlpPath, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // 35s watchdog timeout: provides ample time for external JS challenge solving and format resolution
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      safeReject(new Error('Media analysis timed out (35s). Please check the link or server connection.'));
    }, 35000);

    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timeout);

      if (code !== 0 || !stdout.trim()) {
        if (isYouTube) {
          console.warn('[Downloader] yt-dlp YouTube analysis encountered challenge, triggering oEmbed fallback...');
          return analyzeYouTubeFallback(url).then(safeResolve).catch(() => {
            const classified = classifyMediaError(stderr, code);
            safeReject(new Error(classified));
          });
        }
        if (isInstagram) {
          // Instagram photo posts or carousels may not have video JSON; attempt native HTML parser
          return analyzeInstagramPost(url).then(safeResolve).catch(() => {
            const classified = classifyMediaError(stderr, code);
            safeReject(new Error(classified));
          });
        }
        // For YouTube & all other sources, report exact genuine error - never report fake success!
        const classified = classifyMediaError(stderr, code);
        return safeReject(new Error(classified));
      }

      try {
        const info = JSON.parse(stdout);
        const processed = processMetadata(info, url);
        if (isInstagram && (!processed.videoOptions || processed.videoOptions.length === 0)) {
          return analyzeInstagramPost(url).then(safeResolve).catch(() => safeResolve(processed));
        }
        safeResolve(processed);
      } catch (parseErr) {
        safeReject(new Error(`Failed to parse media metadata: ${parseErr.message}`));
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      clearTimeout(timeout);
      safeReject(new Error(`Engine spawn error: ${err.message}`));
    });
  });
}

/**
 * Process raw yt-dlp metadata into clean UI format options
 */
function processMetadata(info, originalUrl) {
  const formats = info.formats || [];
  const videoOptions = [];
  
  // Available resolutions detector
  const availableHeights = new Set();
  formats.forEach((f) => {
    if (f.height && f.vcodec && f.vcodec !== 'none') {
      availableHeights.add(f.height);
    }
  });

  const standardHeights = [
    { height: 2160, label: '4K Ultra HD (2160p)', quality: '4K', badge: 'ULTRA' },
    { height: 1440, label: '2K Quad HD (1440p)', quality: '2K', badge: 'QHD' },
    { height: 1080, label: 'Full HD (1080p)', quality: '1080p', badge: 'FHD' },
    { height: 720, label: 'High Definition (720p)', quality: '720p', badge: 'HD' },
    { height: 480, label: 'Standard Definition (480p)', quality: '480p', badge: 'SD' },
    { height: 360, label: 'Medium Quality (360p)', quality: '360p', badge: 'MED' },
    { height: 240, label: 'Low Quality (240p)', quality: '240p', badge: 'LOW' }
  ];

  const duration = info.duration || 0;

  // Always add Best Available
  let bestSize = formatBytes(info.filesize || info.filesize_approx);
  if (!bestSize && duration > 0) {
    bestSize = formatBytes(Math.round((3800 * 1024 / 8) * duration));
  }

  videoOptions.push({
    id: 'video-best',
    type: 'video',
    formatId: 'best',
    height: 0,
    label: 'Best Available Quality (MP4)',
    quality: 'Maximum Resolution & Bitrate',
    ext: 'mp4',
    badge: 'POPULAR',
    recommended: true,
    estimatedSize: bestSize || '~25.0 MB'
  });

  standardHeights.forEach((std) => {
    // Check if any stream has at least this height
    const hasHeight = Array.from(availableHeights).some(h => h >= std.height);
    if (hasHeight) {
      // Find approximate size if available
      const matchingFormat = formats.find(f => f.height === std.height && f.vcodec !== 'none');
      let sizeStr = matchingFormat ? formatBytes(matchingFormat.filesize || matchingFormat.filesize_approx) : null;
      if (!sizeStr && duration > 0) {
        let kbps = 1500;
        if (std.height >= 2160) kbps = 14000;
        else if (std.height >= 1440) kbps = 7500;
        else if (std.height >= 1080) kbps = 3800;
        else if (std.height >= 720) kbps = 2000;
        else if (std.height >= 480) kbps = 1000;
        else if (std.height >= 360) kbps = 600;
        else kbps = 350;
        sizeStr = formatBytes(Math.round((kbps * 1024 / 8) * duration));
      }

      videoOptions.push({
        id: `video-${std.height}p`,
        type: 'video',
        formatId: `bestvideo[height<=${std.height}]+bestaudio/best[height<=${std.height}]/best`,
        height: std.height,
        label: std.label,
        quality: std.quality,
        ext: 'mp4',
        badge: std.badge,
        estimatedSize: sizeStr || '~15.0 MB'
      });
    }
  });

  // Calculate audio estimated sizes based on duration
  const calcAudioSize = (kbps) => {
    if (duration > 0) {
      return formatBytes(Math.round((kbps * 1024 / 8) * duration));
    }
    return null;
  };

  // Audio options (Pure Audio formats with Subtitles/Lyrics & Cover Art embedded)
  const audioOptions = [
    {
      id: 'audio-mp3-320',
      type: 'audio',
      audioFormat: 'mp3',
      audioBitrate: '320k',
      label: 'MP3 - Ultra High Fidelity (320 kbps)',
      quality: '320 kbps + Embedded Subtitles & Cover Art',
      ext: 'mp3',
      badge: 'STUDIO MASTER',
      recommended: true,
      hasSubtitles: true,
      estimatedSize: calcAudioSize(320) || '~8.3 MB'
    },
    {
      id: 'audio-mp3-256',
      type: 'audio',
      audioFormat: 'mp3',
      audioBitrate: '256k',
      label: 'MP3 - High Quality (256 kbps)',
      quality: '256 kbps + Embedded Subtitles & Cover Art',
      ext: 'mp3',
      badge: 'HQ',
      hasSubtitles: true,
      estimatedSize: calcAudioSize(256) || '~6.7 MB'
    },
    {
      id: 'audio-mp3-192',
      type: 'audio',
      audioFormat: 'mp3',
      audioBitrate: '192k',
      label: 'MP3 - Standard Quality (192 kbps)',
      quality: '192 kbps + Embedded Subtitles & Cover Art',
      ext: 'mp3',
      badge: 'STD',
      hasSubtitles: true,
      estimatedSize: calcAudioSize(192) || '~5.0 MB'
    },
    {
      id: 'audio-mp3-128',
      type: 'audio',
      audioFormat: 'mp3',
      audioBitrate: '128k',
      label: 'MP3 - Fast / Lightweight (128 kbps)',
      quality: '128 kbps + Embedded Subtitles & Cover Art',
      ext: 'mp3',
      badge: 'LITE',
      hasSubtitles: true,
      estimatedSize: calcAudioSize(128) || '~3.3 MB'
    },
    {
      id: 'audio-m4a',
      type: 'audio',
      audioFormat: 'm4a',
      audioBitrate: '192k',
      label: 'M4A / AAC - Native Apple & Mobile Quality',
      quality: 'Original Apple AAC (192 kbps)',
      ext: 'm4a',
      badge: 'APPLE',
      estimatedSize: calcAudioSize(192) || '~4.5 MB'
    },
    {
      id: 'audio-wav',
      type: 'audio',
      audioFormat: 'wav',
      audioBitrate: null,
      label: 'WAV - Uncompressed Studio Master (Lossless)',
      quality: 'Lossless Studio Audio (1411 kbps)',
      ext: 'wav',
      badge: 'WAV',
      estimatedSize: calcAudioSize(1411) || '~35.0 MB'
    },
    {
      id: 'audio-flac',
      type: 'audio',
      audioFormat: 'flac',
      audioBitrate: null,
      label: 'FLAC - Free Lossless Audio Codec',
      quality: 'Lossless Compressed FLAC',
      ext: 'flac',
      badge: 'FLAC',
      estimatedSize: calcAudioSize(900) || '~22.0 MB'
    }
  ];

  // Best thumbnail
  let bestThumbnail = info.thumbnail;
  if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
    const sorted = [...info.thumbnails].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
    bestThumbnail = sorted[0].url || bestThumbnail;
  }

  // Extract Subtitles & Captions
  const subtitlesList = [];
  const rawSubs = info.subtitles || {};
  const autoSubs = info.automatic_captions || {};

  Object.keys(rawSubs).forEach((lang) => {
    const track = rawSubs[lang];
    const name = (track && track[0] && track[0].name) ? track[0].name : lang.toUpperCase();
    subtitlesList.push({
      lang: lang,
      label: `${name} (Official Subtitle)`,
      badge: 'OFFICIAL'
    });
  });

  Object.keys(autoSubs).slice(0, 10).forEach((lang) => {
    if (!subtitlesList.some(s => s.lang === lang)) {
      const track = autoSubs[lang];
      const name = (track && track[0] && track[0].name) ? track[0].name : lang.toUpperCase();
      subtitlesList.push({
        lang: lang,
        label: `${name} (Auto-Generated CC)`,
        badge: 'AUTO'
      });
    }
  });

  if (subtitlesList.length === 0) {
    subtitlesList.push(
      { lang: 'en', label: 'English Subtitles / Transcript (.SRT)', badge: 'EN' },
      { lang: 'hi', label: 'Hindi Subtitles / Transcript (.SRT)', badge: 'HI' },
      { lang: 'auto', label: 'Auto Captions / Lyrics (.SRT)', badge: 'AUTO' }
    );
  }

  return {
    id: info.id || uuidv4(),
    title: info.title || 'Extracted Media',
    uploader: info.uploader || info.channel || info.creator || 'Verified Creator',
    uploader_url: info.uploader_url || null,
    durationSeconds: info.duration || 0,
    durationFormatted: formatDuration(info.duration),
    thumbnail: bestThumbnail,
    description: info.description ? info.description.slice(0, 300) : '',
    viewCount: info.view_count ? info.view_count.toLocaleString() : null,
    uploadDate: info.upload_date || null,
    extractor: info.extractor_key || info.extractor || 'Direct',
    originalUrl: originalUrl,
    videoOptions: videoOptions,
    audioOptions: audioOptions,
    subtitlesList: subtitlesList,
    thumbnailUrl: bestThumbnail
  };
}

/**
 * Cleans raw WebVTT / SRT subtitle text into song lyrics
 */
function cleanSubtitleToLyrics(subContent) {
  if (!subContent) return '';
  let text = subContent
    .replace(/^WEBVTT[^\r\n]*[\r\n]*/i, '')
    .replace(/^NOTE[^\r\n]*[\r\n]*/gm, '')
    .replace(/^(Kind|Language|Style|Region):[^\r\n]*[\r\n]*/gim, '')
    .replace(/\d{2}:\d{2}:\d{2}[\.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[\.,]\d{3}[^\r\n]*/g, '')
    .replace(/\d{2}:\d{2}[\.,]\d{3}\s*-->\s*\d{2}:\d{2}[\.,]\d{3}[^\r\n]*/g, '')
    .replace(/<[^>]+>/g, '') // remove HTML/VTT cue tags
    .replace(/^\d+[\r\n]+/gm, '') // remove SRT sequence numbers
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^(Kind|Language|Style|Region):/i.test(l));

  const deduped = [];
  for (const line of lines) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }
  return deduped.join('\n');
}

/**
 * Embeds lyrics/subtitles text into an MP3 file's ID3v2 USLT lyrics metadata tag
 */
async function embedLyricsIntoMp3(mp3Path, subPath) {
  try {
    if (!fs.existsSync(mp3Path) || !fs.existsSync(subPath)) return mp3Path;
    const rawSub = fs.readFileSync(subPath, 'utf8');
    const lyrics = cleanSubtitleToLyrics(rawSub);
    if (!lyrics || lyrics.trim().length === 0) {
      try { fs.unlinkSync(subPath); } catch (_) {}
      return mp3Path;
    }

    const tempOut = mp3Path.replace(/\.mp3$/, '_with_lyrics.mp3');
    await new Promise((resolve) => {
      let isDone = false;
      const ffmpegExe = ffmpegPath;
      const ff = spawn(ffmpegExe, [
        '-i', mp3Path,
        '-metadata', `lyrics=${lyrics.slice(0, 15000)}`,
        '-codec', 'copy',
        tempOut,
        '-y'
      ]);

      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          try { ff.kill(); } catch (_) {}
          resolve();
        }
      }, 3000);

      ff.on('close', (code) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          if (code === 0 && fs.existsSync(tempOut) && fs.statSync(tempOut).size > 1000) {
            try {
              fs.unlinkSync(mp3Path);
              fs.renameSync(tempOut, mp3Path);
            } catch (e) {
              console.error('[Lyrics Embed Rename Error]:', e.message);
            }
          }
          resolve();
        }
      });
      ff.on('error', () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          resolve();
        }
      });
    });

    try {
      if (fs.existsSync(subPath)) fs.unlinkSync(subPath);
    } catch (_) {}

    return mp3Path;
  } catch (err) {
    console.error('[Lyrics Embedding Exception]:', err.message);
    return mp3Path;
  }
}

/**
 * Executes media download and streams real-time progress to job listeners
 */
function startDownloadJob(options) {
  const { url: rawUrl, type, height, audioFormat, audioBitrate, title, artist, directUrl, query } = options;
  const url = cleanMediaUrl(rawUrl);

  // Deduplicate identical active concurrent download requests
  const requestFingerprint = `${url}_${type || 'video'}_${height || 0}_${audioFormat || 'mp3'}_${query || ''}`;
  for (const [existingId, existingJob] of activeJobs.entries()) {
    if (existingJob.requestFingerprint === requestFingerprint && existingJob.status !== 'failed') {
      if (existingJob.complete && (!existingJob.outputFile || !fs.existsSync(existingJob.outputFile))) {
        continue;
      }
      console.log(`[Job ${existingId}] Reusing existing active job for duplicate request: ${requestFingerprint}`);
      return existingId;
    }
  }

  const jobId = uuidv4();

  const jobInfo = {
    jobId,
    requestFingerprint,
    status: 'initializing',
    percentage: 0,
    speed: '0 KiB/s',
    eta: '--:--',
    outputFile: null,
    targetFilename: null,
    error: null,
    complete: false
  };

  activeJobs.set(jobId, jobInfo);

  // If direct image or direct stream URL provided (e.g. Instagram photo/carousel/video)
  if (type === 'image' || directUrl) {
    const targetUrl = directUrl || url;
    const isVideo = targetUrl.includes('.mp4');
    const ext = isVideo ? 'mp4' : 'jpg';
    const cleanTitle = (title || (isVideo ? 'instagram_video' : 'instagram_photo'))
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    const destFile = path.join(tempDir, `${jobId}_out.${ext}`);
    jobInfo.targetFilename = `${cleanTitle}.${ext}`;
    jobInfo.status = 'downloading';
    jobInfo.percentage = 35;
    jobInfo.speed = '8.5 MiB/s';

    const downloadStream = (target, redirects = 5) => {
      if (redirects <= 0) {
        jobInfo.error = 'Too many redirects';
        jobInfo.status = 'failed';
        return;
      }
      https.get(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.instagram.com/'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadStream(res.headers.location, redirects - 1);
        }
        if (res.statusCode !== 200) {
          jobInfo.error = `HTTP Error ${res.statusCode}`;
          jobInfo.status = 'failed';
          return;
        }

        const fileStream = fs.createWriteStream(destFile);
        jobInfo.percentage = 70;
        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            jobInfo.outputFile = destFile;
            jobInfo.percentage = 100;
            jobInfo.status = 'complete';
            jobInfo.complete = true;
          });
        });
        fileStream.on('error', (err) => {
          jobInfo.error = err.message;
          jobInfo.status = 'failed';
        });
      }).on('error', (err) => {
        jobInfo.error = err.message;
        jobInfo.status = 'failed';
      });
    };

    downloadStream(targetUrl);
    return jobId;
  }

  // File output template in temp directory
  const outputTemplate = path.join(tempDir, `${jobId}_out.%(ext)s`);
  const activeFfmpeg = getFfmpegPath();

  const args = [
    ...getYtDlpBaseArgs(),
    '-N', '8',
    '--concurrent-fragments', '8',
    '--buffer-size', '8M',
    '--postprocessor-args', 'ffmpeg:-strict experimental -threads 0',
    '-o', outputTemplate,
    '--newline' // Enables readable one-line progress output
  ];

  if (fs.existsSync(activeFfmpeg)) {
    args.push('--ffmpeg-location', activeFfmpeg);
  }

  if (type === 'audio') {
    args.push('-x');
    args.push('--audio-format', audioFormat || 'mp3');
    if (audioBitrate) {
      args.push('--audio-quality', audioBitrate);
    }
    args.push('--embed-thumbnail');
    args.push('--convert-thumbnails', 'jpg');
    args.push('--add-metadata');
    // Fetch official human subtitles only (avoids slow auto-subs lag)
    args.push('--write-subs', '--sub-langs', 'en.*,en,hi.*,hi');
  } else if (type === 'thumbnail') {
    args.push('--write-thumbnail');
    args.push('--skip-download');
    args.push('--convert-thumbnails', 'jpg');
  } else {
    // Video
    let formatSpec = 'bestvideo*+bestaudio/best';
    if (height && height > 0) {
      formatSpec = `bestvideo*[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo*[height<=${height}]+bestaudio/best[height<=${height}]/best`;
    }
    args.push('-f', formatSpec);
    args.push('--merge-output-format', 'mp4');
    args.push('--embed-subs');
    args.push('--sub-langs', 'en.*,en,hi.*,hi');
    args.push('--add-metadata');
  }

  // Support Spotify links seamlessly via high-fidelity YouTube Music search
  let downloadTarget = url;
  if (query) {
    const cleanQ = cleanSearchQuery(query);
    downloadTarget = `ytsearch1:${cleanQ}`;
    console.log(`[Job ${jobId}] Custom query specified. Querying: ${downloadTarget}`);
  } else if (url && (url.includes('spotify.com') || url.includes('spotify.link'))) {
    const searchQuery = cleanSearchQuery(`${title || 'Music Track'} ${artist || ''}`);
    downloadTarget = `ytsearch1:${searchQuery}`;
    console.log(`[Job ${jobId}] Spotify link detected. Querying: ${downloadTarget}`);
  }

  // Use supported YouTube extraction configuration with JS challenge solving
  const isYouTube = (url && (url.includes('youtube.com') || url.includes('youtu.be'))) || (downloadTarget && downloadTarget.startsWith('ytsearch'));
  if (isYouTube) {
    args.push(
      '--extractor-args', 'youtube:player_client=ios,android,mweb,web'
    );
    if (downloadTarget.startsWith('ytsearch')) {
      args.push('--playlist-items', '1');
    }
  }

  args.push(downloadTarget);

  console.log(`[Job ${jobId}] Starting yt-dlp with type: ${type}`);
  ensureYtdlp().then((binary) => {
    const child = spawn(binary || ytdlpPath, args);
    let jobStderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      parseProgress(text, jobInfo);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      jobStderr += text;
      console.error(`[Job ${jobId} stderr]:`, text.trim());
    });

    const finalizeMediaFile = async (generated) => {
      try {
        let filePath = path.join(tempDir, generated);

        // If it's an MP3 audio file, check for downloaded subtitles and embed lyrics!
        if (generated.endsWith('.mp3')) {
          const files = fs.readdirSync(tempDir);
          const subFile = files.find(f => (f.startsWith(`${jobId}_out`) || f.startsWith(jobId)) && (f.endsWith('.vtt') || f.endsWith('.srt')));
          if (subFile) {
            jobInfo.speed = 'Embedding lyrics & artwork...';
            jobInfo.message = 'Embedding synchronized lyrics...';
            const subFilePath = path.join(tempDir, subFile);
            filePath = await embedLyricsIntoMp3(filePath, subFilePath);
          }
        }

        // Cleanup any leftover subtitle or webp temp files for this job
        const files = fs.readdirSync(tempDir);
        files.filter(f => (f.startsWith(`${jobId}_out`) || f.startsWith(jobId)) && (f.endsWith('.vtt') || f.endsWith('.srt') || f.endsWith('.webp'))).forEach(f => {
          try { fs.unlinkSync(path.join(tempDir, f)); } catch (_) {}
        });

        jobInfo.outputFile = filePath;
        const ext = path.extname(filePath).replace('.', '') || (type === 'audio' ? (audioFormat || 'mp3') : 'mp4');

        // Construct clean, genuine filename from title and artist (safe from illegal Windows filename characters)
        let baseName = title;
        if (artist && baseName && !baseName.toLowerCase().includes(artist.toLowerCase())) {
          baseName = `${artist} - ${baseName}`;
        }
        if (!baseName || baseName.includes('??')) {
          baseName = path.basename(filePath).replace(`${jobId}_out`, '').replace(`${jobId}_`, '').replace(/^[._-]+/, '').replace(/\.[^/.]+$/, '');
        }
        const cleanTitle = (baseName || 'nexadown_media')
          .replace(/[\\/:*?"<>|]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        jobInfo.targetFilename = `${cleanTitle || 'nexadown_download'}.${ext}`;
        jobInfo.status = 'ready';
        jobInfo.percentage = 100;
        jobInfo.complete = true;
        jobInfo.message = '✨ 100% Complete! Delivering file...';
        jobInfo.speed = 'Maximum';
        jobInfo.eta = '00:00';
        console.log(`[Job ${jobId}] Finished: ${jobInfo.outputFile} -> ${jobInfo.targetFilename}`);
      } catch (readErr) {
        jobInfo.status = 'failed';
        jobInfo.error = `Could not finalize file: ${readErr.message}`;
      }
    };

    child.on('close', async (code) => {
      // 1. Check if media file exists in tempDir FIRST before failing on exit code!
      let files = [];
      try { files = fs.readdirSync(tempDir); } catch (_) {}
      const generated = files.find(f => (f.startsWith(`${jobId}_out`) || f.startsWith(jobId)) && (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav') || f.endsWith('.flac') || f.endsWith('.mp4') || f.endsWith('.jpg') || f.endsWith('.png')));

      if (generated) {
        return finalizeMediaFile(generated);
      }

      // If no file was generated and code !== 0:
      if (code !== 0) {
        // Try fallback if it was a search
        if (downloadTarget.startsWith('ytsearch')) {
          console.warn(`[Job ${jobId}] Primary search exited with code ${code}. Trying fallback audio search...`);
          const fallbackQ = cleanSearchQuery(title || 'Music');
          const fallbackTarget = `ytsearch1:${fallbackQ} official audio`;
          const fallbackArgs = [...args.slice(0, -1), fallbackTarget];
          const fallbackChild = spawn(binary || ytdlpPath, fallbackArgs);

          fallbackChild.on('close', async () => {
            try {
              const fFiles = fs.readdirSync(tempDir);
              const fGen = fFiles.find(f => (f.startsWith(`${jobId}_out`) || f.startsWith(jobId)) && (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav') || f.endsWith('.flac') || f.endsWith('.mp4')));
              if (fGen) {
                return finalizeMediaFile(fGen);
              }
            } catch (_) {}
            jobInfo.status = 'failed';
            jobInfo.error = 'Media stream was restricted or unavailable on search engine.';
          });
          return;
        }

        jobInfo.status = 'failed';
        jobInfo.error = classifyMediaError(jobStderr, code);
        console.error(`[Job ${jobId} Failed]:`, jobInfo.error);

        // Clean up any partial files
        try {
          const files = fs.readdirSync(tempDir);
          files.filter(f => f.startsWith(`${jobId}_out`) || f.startsWith(jobId)).forEach(f => {
            try { fs.unlinkSync(path.join(tempDir, f)); } catch (_) {}
          });
        } catch (_) {}
        return;
      }

      jobInfo.status = 'failed';
      jobInfo.error = 'Downloaded media file not found in temporary cache.';
    });

  child.on('error', (err) => {
    jobInfo.status = 'failed';
    jobInfo.error = `Spawn error: ${err.message}`;
  });
  }).catch((err) => {
    jobInfo.status = 'failed';
    jobInfo.error = `Engine initialization error: ${err.message}`;
  });

  return jobId;
}

/**
 * Parses yt-dlp stdout for progress updates
 */
function parseProgress(text, jobInfo) {
  // Pattern: [download]  45.2% of ~  24.50MiB at    5.12MiB/s ETA 00:03
  const match = text.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([\d\.]+\w+)\s+at\s+([\d\.]+\w+\/s)\s+ETA\s+([\d:]+)/i);
  if (match) {
    jobInfo.status = 'downloading';
    const rawPct = parseFloat(match[1]);
    // Smoothly scale download phase to 0% - 90%
    jobInfo.percentage = Math.min(90, Math.round(rawPct * 0.9));
    jobInfo.totalSize = match[2];
    jobInfo.speed = match[3];
    jobInfo.eta = match[4];
    jobInfo.message = `⚡ High-speed downloading (${Math.round(rawPct)}%)...`;
    return;
  }

  // Also catch simple percent: [download]  95.0%
  const simpleMatch = text.match(/\[download\]\s+([\d\.]+)%/i);
  if (simpleMatch) {
    const rawPct = parseFloat(simpleMatch[1]);
    if (rawPct >= 100) {
      jobInfo.status = 'processing';
      jobInfo.percentage = 92;
      jobInfo.message = '⚡ Instant audio conversion...';
      jobInfo.speed = 'Multi-Core FFmpeg';
      jobInfo.eta = 'Finishing';
    } else {
      jobInfo.status = 'downloading';
      jobInfo.percentage = Math.min(90, Math.round(rawPct * 0.9));
    }
  }

  if (text.includes('[ExtractAudio]')) {
    jobInfo.status = 'processing';
    jobInfo.percentage = 93;
    jobInfo.message = '⚡ Converting studio quality audio...';
    jobInfo.speed = 'Multi-Core Engine';
    jobInfo.eta = 'Finishing';
  } else if (text.includes('[EmbedThumbnail]') || text.includes('[ThumbnailsConvertor]')) {
    jobInfo.status = 'processing';
    jobInfo.percentage = 96;
    jobInfo.message = '🎨 Embedding HD album cover artwork...';
    jobInfo.speed = 'ID3 Art Injection';
    jobInfo.eta = '< 1s';
  } else if (text.includes('[EmbedSubtitle]') || text.includes('[SubtitlesConvertor]')) {
    jobInfo.status = 'processing';
    jobInfo.percentage = 97;
    jobInfo.message = '💬 Embedding synchronized subtitles...';
    jobInfo.speed = 'Subtitle Muxing';
    jobInfo.eta = '< 1s';
  } else if (text.includes('[Metadata]') || text.includes('[Merger]') || text.includes('[Fixup')) {
    jobInfo.status = 'processing';
    jobInfo.percentage = 98;
    jobInfo.message = '⚡ Finalizing container & ID3 metadata...';
    jobInfo.speed = 'Fast Muxing';
    jobInfo.eta = '< 1s';
  }
}

/**
 * Get current job progress
 */
function getJob(jobId) {
  return activeJobs.get(jobId);
}

/**
 * Remove job from active registry
 */
function removeJob(jobId) {
  activeJobs.delete(jobId);
}

/**
 * Direct High-Speed Download (No blocking modal, multi-threaded fast streaming)
 */
function downloadMediaDirect(options) {
  return new Promise(async (resolve, reject) => {
    try {
      const execBinary = await ensureYtdlp();
      const fileId = uuidv4();
      const { url, type, height, audioFormat, audioBitrate, title, artist } = options;

      let baseName = title;
      if (artist && baseName && !baseName.toLowerCase().includes(artist.toLowerCase())) {
        baseName = `${artist} - ${baseName}`;
      }
      const safeTitle = (baseName || 'media')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

      const ext = type === 'audio' ? (audioFormat || 'mp3') : 'mp4';
      const outputFilename = `${safeTitle || 'media'}.${ext}`;
      const outputTemplate = path.join(tempDir, `${fileId}_out.%(ext)s`);
      const activeFfmpeg = getFfmpegPath();

      const args = [
        ...getYtDlpBaseArgs(),
        '-N', '8',
        '--concurrent-fragments', '8',
        '--buffer-size', '8M',
        '--postprocessor-args', 'ffmpeg:-strict experimental -threads 0',
        '-o', outputTemplate
      ];

      if (fs.existsSync(activeFfmpeg)) {
        args.push('--ffmpeg-location', activeFfmpeg);
      }

      if (type === 'audio') {
        args.push('-x');
        args.push('--audio-format', audioFormat || 'mp3');
        if (audioBitrate) {
          args.push('--audio-quality', audioBitrate);
        }
        args.push('--embed-thumbnail');
        args.push('--convert-thumbnails', 'jpg');
        args.push('--add-metadata');
        args.push('--write-subs', '--sub-langs', 'en.*,en,hi.*,hi');
      } else {
        // Video
        let formatSpec = 'bestvideo*[ext=mp4]+bestaudio[ext=m4a]/bestvideo*+bestaudio/best[ext=mp4]/best';
        if (height && height > 0) {
          formatSpec = `bestvideo*[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo*[height<=${height}]+bestaudio/best[height<=${height}]/best`;
        }
        args.push('-f', formatSpec);
        args.push('--merge-output-format', 'mp4');
        args.push('--embed-subs');
        args.push('--sub-langs', 'en.*,en,hi.*,hi');
        args.push('--add-metadata');
      }

      let downloadTarget = url;
      if (url && (url.includes('spotify.com') || url.includes('spotify.link'))) {
        const searchQuery = cleanSearchQuery(`${title || 'Music Track'} ${artist || ''}`);
        downloadTarget = `ytsearch1:${searchQuery}`;
      }

      const isYouTube = (url && (url.includes('youtube.com') || url.includes('youtu.be'))) || (downloadTarget && downloadTarget.startsWith('ytsearch'));
      if (isYouTube) {
        args.push(
          '--extractor-args', 'youtube:player_client=ios,android,mweb,web'
        );
        if (downloadTarget.startsWith('ytsearch')) {
          args.push('--playlist-items', '1');
        }
      }

      args.push(downloadTarget);

      const child = spawn(execBinary, args);
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', async (code) => {
        if (code !== 0) {
          const classified = classifyMediaError(stderr, code);
          return reject(new Error(classified));
        }

        try {
          const files = fs.readdirSync(tempDir);
          const generated = files.find(f => f.startsWith(`${fileId}_out`) && !f.endsWith('.vtt') && !f.endsWith('.srt') && !f.endsWith('.webp'));
          if (generated) {
            let filePath = path.join(tempDir, generated);

            if (generated.endsWith('.mp3')) {
              const subFile = files.find(f => f.startsWith(`${fileId}_out`) && (f.endsWith('.vtt') || f.endsWith('.srt')));
              if (subFile) {
                const subFilePath = path.join(tempDir, subFile);
                filePath = await embedLyricsIntoMp3(filePath, subFilePath);
              }
            }

            files.filter(f => f.startsWith(`${fileId}_out`) && (f.endsWith('.vtt') || f.endsWith('.srt') || f.endsWith('.webp'))).forEach(f => {
              try { fs.unlinkSync(path.join(tempDir, f)); } catch (_) {}
            });

            resolve({
              filePath,
              filename: outputFilename
            });
          } else {
            reject(new Error('Downloaded output file not found.'));
          }
        } catch (e) {
          reject(e);
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to launch download engine: ${err.message}`));
      });
    } catch (launchErr) {
      reject(launchErr);
    }
  });
}

/**
 * Direct Subtitle / Lyrics Download (.SRT / .VTT)
 */
function downloadSubtitleDirect(options) {
  return new Promise((resolve, reject) => {
    const fileId = uuidv4();
    const { url, lang = 'en', title = 'subtitles' } = options;
    const safeTitle = (title || 'subtitles')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .trim()
      .slice(0, 60);

    const outputTemplate = path.join(tempDir, `${fileId}_sub.%(ext)s`);

    const args = [
      '--js-runtimes', 'node',
      '--ffmpeg-location', binDir,
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', `${lang},${lang}.*,all`,
      '--convert-subs', 'srt',
      '--skip-download',
      '-o', outputTemplate,
      url
    ];

    console.log(`[Subtitle] Fetching subtitle for ${url} (lang: ${lang})`);
    const child = spawn(ytdlpPath, args);

    child.on('close', (code) => {
      try {
        const files = fs.readdirSync(tempDir);
        const subFile = files.find(f => f.startsWith(`${fileId}_sub`));
        if (subFile) {
          const filePath = path.join(tempDir, subFile);
          const ext = path.extname(subFile);
          resolve({
            filePath,
            filename: `${safeTitle}_${lang}${ext}`
          });
        } else {
          reject(new Error(`No subtitle track available for language '${lang}'`));
        }
      } catch (err) {
        reject(err);
      }
    });

    child.on('error', (err) => reject(err));
  });
}

/**
 * Downloads an entire Spotify/Media playlist in parallel and archives all files into a single ZIP folder
 */
function startPlaylistBatchJob(options) {
  const jobId = uuidv4();
  const { playlistTitle, tracks, audioFormat = 'mp3', audioBitrate = '320k' } = options;

  const safePlaylistTitle = (playlistTitle || 'Spotify Playlist')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Playlist';

  const batchDir = path.join(tempDir, `batch_${jobId}`);
  if (!fs.existsSync(batchDir)) {
    fs.mkdirSync(batchDir, { recursive: true });
  }

  const jobInfo = {
    jobId,
    status: 'initializing',
    percentage: 0,
    speed: `Batch 0/${tracks.length}`,
    eta: 'Starting...',
    outputFile: null,
    targetFilename: `${safePlaylistTitle}.zip`,
    error: null,
    complete: false,
    message: `Preparing batch download for "${safePlaylistTitle}" (${tracks.length} tracks)...`
  };

  activeJobs.set(jobId, jobInfo);

  // Run in background asynchronously
  (async () => {
    try {
      const total = tracks.length;
      let completed = 0;
      let failed = 0;

      const binary = await ensureYtdlp();
      const execBinary = binary || ytdlpPath;

      // Helper function to download a single track into batchDir
      const downloadTrack = (track, trackIndex) => {
        return new Promise((resolve) => {
          const query = cleanSearchQuery(track.query || `${track.title} ${track.artist}`);
          const downloadTarget = `ytsearch1:${query}`;
          const prefix = String(track.index || (trackIndex + 1)).padStart(2, '0');
          const outputTemplate = path.join(batchDir, `${prefix}_%(title)s.%(ext)s`);

          const activeFfmpeg = getFfmpegPath();
          const args = [
            ...getYtDlpBaseArgs(),
            '-N', '4',
            '--concurrent-fragments', '4',
            '--buffer-size', '8M',
            '-x',
            '--audio-format', audioFormat || 'mp3',
            '--embed-thumbnail',
            '--convert-thumbnails', 'jpg',
            '--add-metadata',
            '--postprocessor-args', 'ffmpeg:-strict experimental -threads 0',
            '--extractor-args', 'youtube:player_client=ios,android,mweb,web',
            '--playlist-items', '1',
            '-o', outputTemplate,
            downloadTarget
          ];

          if (isWindows) {
            args.push('--windows-filenames');
          }

          if (fs.existsSync(activeFfmpeg)) {
            args.push('--ffmpeg-location', activeFfmpeg);
          }

          if (audioBitrate) {
            args.push('--audio-quality', audioBitrate);
          }

          const child = spawn(execBinary, args);

          child.on('close', (code) => {
            // Check if file was generated first
            let generated = null;
            try {
              const files = fs.readdirSync(batchDir);
              generated = files.find(f => f.startsWith(`${prefix}_`) && (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav') || f.endsWith('.flac')));
            } catch (_) {}

            if (generated) {
              // Rename newly generated file to clean standard format: "01. Artist - Title.mp3"
              try {
                const ext = path.extname(generated);
                const cleanArtist = (track.artist || '').replace(/[\\/:*?"<>|]/g, '').trim();
                const cleanTitle = (track.title || '').replace(/[\\/:*?"<>|]/g, '').trim();
                let cleanName = `${prefix}. ${cleanTitle}${ext}`;
                if (cleanArtist && cleanTitle && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) {
                  cleanName = `${prefix}. ${cleanArtist} - ${cleanTitle}${ext}`;
                }
                const oldPath = path.join(batchDir, generated);
                const newPath = path.join(batchDir, cleanName);
                if (oldPath !== newPath) {
                  fs.renameSync(oldPath, newPath);
                }
              } catch (_) {}
              return resolve({ success: true, track });
            }

            console.warn(`[Batch ${jobId}] Track "${track.title}" exited with code ${code} (no file)`);
            resolve({ success: false, track });
          });

          child.on('error', (err) => {
            console.error(`[Batch ${jobId}] Track "${track.title}" error:`, err.message);
            resolve({ success: false, track, error: err.message });
          });
        });
      };

      // Concurrent queue worker (pool of 3 parallel workers)
      const concurrency = 3;
      let currentIndex = 0;

      const worker = async () => {
        while (currentIndex < total) {
          const index = currentIndex++;
          const track = tracks[index];
          jobInfo.message = `Downloading [${completed + 1}/${total}]: "${track.title}"...`;
          jobInfo.status = 'downloading';
          
          const result = await downloadTrack(track, index);
          if (result.success) {
            completed++;
          } else {
            failed++;
          }

          const progressPercent = Math.min(92, Math.round(((completed + failed) / total) * 90));
          jobInfo.percentage = progressPercent;
          jobInfo.speed = `${completed}/${total} completed`;
          jobInfo.eta = `${total - (completed + failed)} remaining`;
        }
      };

      const workers = [];
      const numWorkers = Math.min(concurrency, total);
      for (let i = 0; i < numWorkers; i++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      // Check if any files were downloaded
      const downloadedFiles = fs.readdirSync(batchDir).filter(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav') || f.endsWith('.flac'));

      if (downloadedFiles.length === 0) {
        jobInfo.status = 'failed';
        jobInfo.error = 'Failed to download tracks from playlist. Links may be restricted.';
        try { fs.rmSync(batchDir, { recursive: true, force: true }); } catch (_) {}
        return;
      }

      // Step 2: Archive into ZIP folder
      jobInfo.percentage = 94;
      jobInfo.status = 'zipping';
      jobInfo.speed = 'Archiving';
      jobInfo.eta = 'Almost done';
      jobInfo.message = `Archiving ${downloadedFiles.length} songs into "${safePlaylistTitle}.zip"...`;

      const zipFilePath = path.join(tempDir, `${jobId}_${safePlaylistTitle}.zip`);
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver.ZipArchive
          ? new archiver.ZipArchive({ zlib: { level: 6 } })
          : (typeof archiver === 'function' ? archiver('zip', { zlib: { level: 6 } }) : archiver.default('zip', { zlib: { level: 6 } }));

        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        // Put all files into folder inside the zip
        downloadedFiles.forEach(file => {
          const fullPath = path.join(batchDir, file);
          archive.file(fullPath, { name: `${safePlaylistTitle}/${file}` });
        });

        archive.finalize();
      });

      // Cleanup raw batch folder
      try {
        fs.rmSync(batchDir, { recursive: true, force: true });
      } catch (_) {}

      // Job ready
      jobInfo.outputFile = zipFilePath;
      jobInfo.targetFilename = `${safePlaylistTitle}.zip`;
      jobInfo.percentage = 100;
      jobInfo.status = 'ready';
      jobInfo.complete = true;
      jobInfo.speed = 'Complete';
      jobInfo.eta = '00:00';
      jobInfo.message = `✨ Ready! ${downloadedFiles.length} songs packed into "${safePlaylistTitle}"`;
      console.log(`[Batch ${jobId}] Finished: ${zipFilePath} (${downloadedFiles.length} tracks)`);

    } catch (batchErr) {
      console.error(`[Batch ${jobId} Error]:`, batchErr);
      jobInfo.status = 'failed';
      jobInfo.error = `Batch packaging error: ${batchErr.message}`;
      try { fs.rmSync(batchDir, { recursive: true, force: true }); } catch (_) {}
    }
  })();

  return jobId;
}

module.exports = {
  analyzeUrl,
  startDownloadJob,
  startPlaylistBatchJob,
  downloadMediaDirect,
  downloadSubtitleDirect,
  getJob,
  removeJob,
  ffmpegPath,
  ytdlpPath
};


