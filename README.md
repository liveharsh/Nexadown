# 🚀 NEXADOWN 3D — Full-Stack Video & Audio Downloader

An ultra-modern, production-grade video and audio downloader website featuring an interactive 3D WebGL interface (Three.js), glowing holographic cards, and a robust, secure Node.js Express backend. Built with a modular provider architecture, concurrency-managed media processing, strict anti-SSRF protections, real-time Server-Sent Events (SSE) progress tracking, and full Render cloud compatibility.

---

## ✨ Features & Architecture Highlights

### 🎨 Frontend Experience
- **Interactive 3D WebGL Canvas**: Holographic gyroscope rings, crystalline polyhedra, and 2,000+ glowing particle nebula driven by Three.js with mouse parallax damping.
- **SaveFrom & NexaDown Responsive UI**: Large unified URL search bar, platform quick selectors, and instant format selection cards.
- **Real-Time SSE Download Modal**: Live progress bar, download speed, file size, ETA, multi-step pipeline tracking, and one-click job cancellation.
- **Built-in Local Media Converter**: Drag-and-drop client converter for MP4, MKV, AVI, MOV, and WEBM using FFmpeg.
- **Audio Synthesizer FX**: Immersive UI clicks, switches, and alerts using the Web Audio API.

### 🛡️ Production-Grade Backend
- **Modular Provider Architecture**: Dedicated metadata and download adapters for YouTube, Instagram, Facebook, TikTok, and direct stream URLs.
- **Strict Anti-SSRF Protection**: Validates protocols (HTTP/HTTPS only), resolves hostnames to verify against private RFC 1918 IPv4 ranges, loopbacks (`127.0.0.0/8`, `localhost`), link-local (`169.254.0.0/16`), AWS/GCP cloud metadata endpoints (`169.254.169.254`), and IPv6 locals.
- **Sliding-Window Rate Limiting**: In-memory rate limiting with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` HTTP response headers.
- **Concurrency & Job Management**: Concurrency limiter (`MAX_CONCURRENT_JOBS = 4`), in-memory job registry (`queued`, `processing`, `completed`, `failed`), and clean process abort on `DELETE /api/jobs/:id`.
- **Ephemeral Storage & Sweeper**: Dedicated temporary file directory with immediate streaming pipeline cleanup and an automated background sweeper removing stale files older than 15 minutes.
- **Zero-RAM Buffering**: Media is streamed or piped in chunks without loading entire files into server memory.
- **Cross-Platform Engine**: Automatically detects and utilizes system or bundled `yt-dlp` and `ffmpeg` binaries across Windows (`.exe`) and Linux (Render containers).

---

## 📁 Repository Structure

```
nexadown-3d/
├── middleware/
│   ├── rateLimit.js            # In-memory sliding-window rate limiter
│   └── validateUrl.js          # URL protocol, domain allowlist, & SSRF firewall
├── public/
│   ├── css/
│   │   └── style.css           # 3D styling, glassmorphism, responsive cards
│   ├── js/
│   │   ├── app.js              # Client state, API interactions, SSE listener, cancellation
│   │   ├── audio-fx.js         # Web Audio API sound generator
│   │   └── three-scene.js      # Three.js 3D canvas and dynamic particle nebula
│   └── index.html              # Main single-page application dashboard
├── routes/
│   ├── analyze.js              # POST /api/analyze (metadata extraction)
│   ├── download.js             # POST /api/download, SSE progress, & stream delivery
│   ├── health.js               # GET /api/health (server metrics & binary status)
│   └── jobs.js                 # GET /api/jobs/:id & DELETE /api/jobs/:id (job control)
├── scripts/
│   └── setup-engine.js         # Cross-platform engine downloader (yt-dlp & FFmpeg)
├── services/
│   ├── mediaProcessor.js       # Concurrency limiter, job registry, spawn manager, cleanup
│   └── providers/
│       ├── direct.js           # Direct media file provider (.mp4, .webm, .mp3)
│       ├── facebook.js         # Facebook video and reels adapter
│       ├── index.js            # Provider registry & platform resolver
│       ├── instagram.js        # Instagram reels and posts adapter
│       ├── tiktok.js           # TikTok watermark-free adapter
│       └── youtube.js          # YouTube 4K/1080p video, 320k audio, subtitles adapter
├── src/
│   ├── converter.js            # FFmpeg local audio conversion
│   ├── downloader.js           # Legacy extraction helper
│   ├── security.js             # Legacy security validator
│   └── server.js               # Entrypoint forwarder to root server.js
├── tests/
│   └── api.test.js             # Automated test suite (Node.js native test runner)
├── utils/
│   └── errors.js               # Standardized API error classes & Express error handler
├── .env.example                # Sample environment variables
├── .gitignore                  # Git exclusions (node_modules, bin, temp, .env)
├── package.json                # Dependencies, scripts, and engine hooks
├── render.yaml                 # Render cloud web service deployment blueprint
├── server.js                   # Main Express application entrypoint
├── start.bat                   # 1-Click local Windows launcher
└── README.md                   # Full documentation
```

---

## 🔌 Backend API Specification

All API endpoints return JSON formatted responses with standardized error handling.

### 1. Health Check
```http
GET /api/health
```
**Response (200 OK):**
```json
{
  "status": "online",
  "version": "2.0.0",
  "uptime": 124.5,
  "engines": {
    "ytdlp": true,
    "ffmpeg": true
  },
  "jobs": {
    "active": 0,
    "maxConcurrent": 4
  }
}
```

### 2. Media Analysis
```http
POST /api/analyze
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "platform": "youtube"
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "platform": "youtube",
  "metadata": {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "duration": 213,
    "uploader": "Rick Astley",
    "formats": [
      {
        "formatId": "video_1080",
        "resolution": "1080p",
        "ext": "mp4",
        "hasAudio": true,
        "filesize": 45000000,
        "note": "Full HD 1080p MP4"
      },
      {
        "formatId": "audio_320",
        "resolution": "Audio",
        "ext": "mp3",
        "hasAudio": true,
        "filesize": 8500000,
        "note": "MP3 Studio Master (320 kbps)"
      }
    ],
    "subtitles": [
      { "lang": "en", "name": "English", "url": "/api/download/subtitle?..." }
    ]
  }
}
```

### 3. Start Media Download
```http
POST /api/download
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "formatId": "video_1080"
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "jobId": "c4ebaef3-f7a9-4f08-8f7d-f8b3ccffeb4a",
  "status": "queued",
  "streamUrl": "/api/download/file/c4ebaef3-f7a9-4f08-8f7d-f8b3ccffeb4a/media.mp4",
  "progressUrl": "/api/download/progress/c4ebaef3-f7a9-4f08-8f7d-f8b3ccffeb4a"
}
```

### 4. Real-Time Progress Stream (SSE)
```http
GET /api/download/progress/:jobId
Accept: text/event-stream
```
**Streamed SSE Data Payload:**
```json
{
  "jobId": "c4ebaef3-f7a9-4f08-8f7d-f8b3ccffeb4a",
  "status": "processing",
  "progress": 64.2,
  "speed": "5.4 MiB/s",
  "size": "42.1 MiB / 65.5 MiB",
  "eta": "00:04",
  "message": "Downloading video stream..."
}
```

### 5. Check Job Status
```http
GET /api/jobs/:id
```
**Response (200 OK):**
```json
{
  "success": true,
  "job": {
    "id": "c4ebaef3-f7a9-4f08-8f7d-f8b3ccffeb4a",
    "status": "processing",
    "progress": 78.5,
    "speed": "6.1 MiB/s",
    "createdAt": 1729524000000
  }
}
```

### 6. Cancel Active Job
```http
DELETE /api/jobs/:id
```
**Response (200 OK):**
```json
{
  "success": true,
  "message": "Job cancelled and temporary files cleaned up."
}
```

---

## 💻 Local Setup & Development

### Prerequisites
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9+
- **yt-dlp** and **FFmpeg**: Handled automatically by the setup script, or detected from your system `PATH`.

### 1. Installation
```bash
git clone https://github.com/your-username/nexadown-3d.git
cd nexadown-3d
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default parameters in `.env`:
```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
MAX_CONCURRENT_JOBS=4
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60
TEMP_CLEANUP_INTERVAL_MS=300000
TEMP_FILE_MAX_AGE_MS=900000
```

### 3. Run Automated Tests
Execute the built-in automated test suite:
```bash
npm test
```
All 12 unit/integration tests verify:
- Health check route response
- URL syntax and protocol rejection
- Domain allowlist verification
- Loopback, local network, and Cloud metadata anti-SSRF protection
- Rate-limiting header injection
- Job creation, status retrieval, and cancellation
- Download parameter validation

### 4. Start Development Server
```bash
npm run dev
```
Or start the production server:
```bash
npm start
```
Access the application at `http://localhost:3000`.

---

## ☁️ Render Deployment Guide

The repository includes a ready-to-deploy [`render.yaml`](file:///D:/nexadown-3d/render.yaml) specification configured for Render's Linux environment.

### 1. One-Click Blueprint Deployment
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** > **Blueprint**.
3. Connect your GitHub repository.
4. Render detects `render.yaml` automatically and configures the web service.

### 2. Manual Web Service Configuration
If creating a Web Service manually:
- **Environment**: Node
- **Region**: Oregon (US West) or Frankfurt (EU)
- **Branch**: `main`
- **Build Command**:
  ```bash
  npm run build
  ```
- **Start Command**:
  ```bash
  npm start
  ```

### 3. Recommended Environment Variables
Configure these in the Render Dashboard under **Environment**:
| Variable | Value | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enables Express production optimizations |
| `PORT` | `10000` | Injected automatically by Render |
| `MAX_CONCURRENT_JOBS` | `4` | Prevents CPU throttling on free/starter tiers |
| `RATE_LIMIT_MAX_REQUESTS` | `60` | Max requests per minute per IP |
| `CORS_ORIGIN` | `*` | Allowed origins (or your custom domain) |

### 4. Operational Monitoring & Verification
1. **Health Verification**:
   Navigate to `https://your-service.onrender.com/api/health`.
   Confirm `"status": "online"` and `"engines": { "ytdlp": true, "ffmpeg": true }`.
2. **Log Inspection**:
   - Access the **Logs** tab in Render to view real-time incoming requests, active job execution, and cleanup notices.
3. **Troubleshooting & Diagnostics**:
   - **Missing Binaries**: The `npm run build` step triggers `scripts/setup-engine.js`, which downloads the Linux x86_64 `yt-dlp` binary and marks it executable (`chmod 755`). If binary execution fails, ensure the service has outbound internet access during build.
   - **Platform Restrictions**: If YouTube or Instagram blocks an IP due to rate limits or bot checks, the backend catches the provider error, logs it securely without leaking internal paths, and returns an informative HTTP 403/429 JSON response.
   - **Timeout on Large Files**: On Render free tiers, HTTP connections may timeout after 100 seconds. Media streams are piped in real time so the connection begins immediately and does not trigger timeout warnings.

---

## 🔒 Security Best Practices

1. **SSRF Firewall**: Any URL input submitted to `/api/analyze` or `/api/download` is resolved against DNS. IP addresses within RFC 1918 (e.g. `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), local loopbacks (`127.0.0.1`), IPv6 locals (`::1`, `fc00::/7`), and AWS/GCP metadata (`169.254.169.254`) are immediately rejected with an HTTP 400 Bad Request error.
2. **Path Sanitization**: Filenames generated for client downloads are stripped of path traversal characters (`..`, `/`, `\`), null bytes, and shell operators.
3. **No Shell Injections**: External processes are spawned using `child_process.spawn` with an array of distinct string arguments, preventing shell injection vulnerabilities.
4. **Rate Limiting**: Defends endpoints against spam and denial-of-service attempts.

---

## 📄 License
MIT License. Built for personal, educational, and authorized media processing.
