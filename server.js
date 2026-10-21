/**
 * NEXADOWN 3D - Production Express Server
 * Full-stack video & audio downloader engine with anti-SSRF security,
 * rate limiting, modular providers, and Render deployment support.
 */

// Load environment variables from .env if available
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[key] = val.trim();
      }
    }
  }
} catch (_) {}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const multer = require('multer');

const { errorHandler, NotFoundError } = require('./utils/errors');
const { createRateLimiter } = require('./middleware/rateLimit');

// Route modules
const healthRoutes = require('./routes/health');
const analyzeRoutes = require('./routes/analyze');
const downloadRoutes = require('./routes/download');
const jobsRoutes = require('./routes/jobs');
const { convertLocalAudio } = require('./src/converter');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Ensure required directories exist
const tempDir = path.join(__dirname, 'temp');
const uploadDir = path.join(tempDir, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer upload config for local file conversion (max 250MB)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 } // 250MB maximum
});

// Security & Parsing Middleware
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global API Rate Limiter (Default: 150 requests per 15 minutes)
const apiRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 150,
  message: 'API rate limit exceeded. Please wait a few minutes before submitting new requests.'
});
app.use('/api/', apiRateLimiter);

// Serve frontend static assets
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// Mount API Routes
app.use('/api', healthRoutes);
app.use('/api', analyzeRoutes);
app.use('/api', downloadRoutes);
app.use('/api/jobs', jobsRoutes);

/**
 * Local Media Converter endpoint (Drag & Drop conversion)
 */
app.post('/api/convert-local', upload.single('mediaFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No media file was uploaded.' });
    }

    const { format = 'mp3', bitrate = '320k' } = req.body;
    console.log(`[Converter] Local file conversion: ${req.file.originalname} -> ${format} (${bitrate})`);

    const result = await convertLocalAudio(req.file.path, req.file.originalname, format, bitrate);
    const stat = fs.statSync(result.filePath);

    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);

    const stream = fs.createReadStream(result.filePath);
    stream.pipe(res);

    stream.on('end', () => {
      setTimeout(() => {
        try {
          if (fs.existsSync(result.filePath)) fs.unlinkSync(result.filePath);
        } catch (_) {}
      }, 2000);
    });
  } catch (err) {
    next(err);
  }
});

// Catch unknown API endpoints with 404
app.all('/api/*', (req, res, next) => {
  next(new NotFoundError(`API endpoint '${req.method} ${req.path}' does not exist.`));
});

// Global Error Handler
app.use(errorHandler);

// Self-ping to prevent Render Free tier sleep
const renderHost = process.env.RENDER_EXTERNAL_URL;
if (renderHost) {
  setInterval(() => {
    https.get(`${renderHost}/api/health`, () => {}).on('error', () => {});
  }, 10 * 60 * 1000).unref?.();
}

// Only listen if executed directly (allows test runner imports without port collisions)
if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║      🚀 NEXADOWN 3D - Production Downloader Backend       ║
  ║                                                           ║
  ║   🌐 Web Dashboard: http://localhost:${PORT}               ║
  ║   ⚡ API Health:    http://localhost:${PORT}/api/health    ║
  ║   🛡️ Security:      SSRF Protected & Rate Limited         ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown
  const handleShutdown = () => {
    console.log('\nGracefully shutting down NEXADOWN server...');
    server.close(() => {
      console.log('Server terminated cleanly.');
      process.exit(0);
    });
  };
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}

module.exports = app;
