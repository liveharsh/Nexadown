/**
 * NEXADOWN - Health Check Route
 * GET /api/health
 */

const express = require('express');
const fs = require('fs');
const { ffmpegPath, ytdlpPath, MAX_CONCURRENT_JOBS, activeJobs } = require('../services/mediaProcessor');

const router = express.Router();

router.get('/health', (req, res) => {
  const ytdlpReady = fs.existsSync(ytdlpPath);
  const ffmpegReady = fs.existsSync(ffmpegPath);

  let activeCount = 0;
  for (const job of activeJobs.values()) {
    if (job.status === 'processing') activeCount++;
  }

  res.json({
    status: 'online',
    appName: 'NEXADOWN',
    version: '2.0.0',
    engines: {
      ytdlp: ytdlpReady ? 'available' : 'missing',
      ffmpeg: ffmpegReady ? 'available' : 'missing'
    },
    concurrency: {
      active: activeCount,
      max: MAX_CONCURRENT_JOBS
    },
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
