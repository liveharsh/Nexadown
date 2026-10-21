/**
 * NEXADOWN - Download & Streaming Route
 * POST /api/download and associated download endpoints
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { validateMediaUrl, validateUrlMiddleware } = require('../middleware/validateUrl');
const { createJob, getJob, streamJobFile, removeJob, ytdlpPath, getYtDlpBaseArgs } = require('../services/mediaProcessor');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { spawn } = require('child_process');

const router = express.Router();

/**
 * Standard Production Download Endpoint
 * POST /api/download
 */
router.post('/download', validateUrlMiddleware, async (req, res, next) => {
  try {
    const { formatId, type, height, audioFormat, bitrate, title, artist, directUrl, query } = req.body;
    const url = req.validatedUrl;

    const jobId = createJob({
      url,
      type: type || 'video',
      height: height ? parseInt(height, 10) : 0,
      formatId: formatId || null,
      audioFormat: audioFormat || 'mp3',
      audioBitrate: bitrate || '320k',
      title: title || 'media',
      artist: artist || '',
      directUrl: directUrl || null,
      query: query || null
    });

    res.status(202).json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Download job queued successfully.',
      statusUrl: `/api/jobs/${jobId}`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Backwards-Compatible Download Start Endpoint
 * POST /api/download/start
 */
router.post('/download/start', validateUrlMiddleware, async (req, res, next) => {
  try {
    const { formatId, type, height, audioFormat, format, audioBitrate, bitrate, title, artist, directUrl, query } = req.body;
    const url = req.validatedUrl;

    const jobId = createJob({
      url,
      type: type || 'video',
      height: height ? parseInt(height, 10) : 0,
      formatId: formatId || null,
      audioFormat: audioFormat || format || 'mp3',
      audioBitrate: audioBitrate || bitrate || '320k',
      title: title || 'media',
      artist: artist || '',
      directUrl: directUrl || null,
      query: query || null
    });

    res.json({
      success: true,
      jobId
    });
  } catch (err) {
    next(err);
  }
});

/**
 * SSE endpoint for live progress streaming
 * GET /api/download/progress/:jobId
 */
router.get('/download/progress/:jobId', (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) {
      throw new NotFoundError('Job not found or expired.', 'JOB_NOT_FOUND');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendUpdate = () => {
      const current = getJob(jobId);
      if (!current) {
        res.write(`data: ${JSON.stringify({ status: 'expired' })}\n\n`);
        clearInterval(interval);
        return res.end();
      }

      res.write(`data: ${JSON.stringify(current)}\n\n`);

      if (current.complete || current.status === 'failed' || current.status === 'cancelled') {
        clearInterval(interval);
        setTimeout(() => {
          try { res.end(); } catch (_) {}
        }, 500);
      }
    };

    const interval = setInterval(sendUpdate, 250);
    sendUpdate();

    req.on('close', () => {
      clearInterval(interval);
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Direct JSON status check
 * GET /api/download/status/:jobId
 */
router.get('/download/status/:jobId', (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = getJob(jobId);
    if (!job) {
      throw new NotFoundError('Job not found or expired.', 'JOB_NOT_FOUND');
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

/**
 * Stream & deliver the processed media file directly to client
 * GET /api/download/file/:jobId
 * GET /api/download/file/:jobId/:filename
 */
router.get(['/download/file/:jobId', '/download/file/:jobId/:filename'], (req, res, next) => {
  try {
    const { jobId } = req.params;
    streamJobFile(jobId, req, res);
  } catch (err) {
    next(err);
  }
});

/**
 * Direct Subtitle / Lyrics Download (.SRT)
 * GET /api/download/subtitle
 */
router.get('/download/subtitle', async (req, res, next) => {
  try {
    const { url, lang = 'en', title = 'subtitles' } = req.query;
    if (!url) throw new BadRequestError('URL is required.', 'MISSING_URL');

    const validation = await validateMediaUrl(url);
    if (!validation.valid) throw new BadRequestError(validation.error);

    const safeTitle = (title || 'subtitles').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const filename = `${safeTitle}_${lang}.srt`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Fetch subtitles via yt-dlp
    const args = ['--skip-download', '--write-sub', '--sub-lang', lang, '--sub-format', 'srt', '-o', '-', url];
    const child = spawn(ytdlpPath, args);

    child.stdout.pipe(res);
    child.on('error', (e) => {
      if (!res.headersSent) res.status(500).send('Subtitle extraction error.');
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
