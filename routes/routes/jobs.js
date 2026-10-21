/**
 * NEXADOWN - Job Management & Cancellation Routes
 * GET /api/jobs/:id
 * DELETE /api/jobs/:id
 */

const express = require('express');
const { getJob, cancelJob } = require('../services/mediaProcessor');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();

/**
 * Get job status
 * GET /api/jobs/:id
 */
router.get('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const job = getJob(id);

    if (!job) {
      throw new NotFoundError(`Job with ID '${id}' not found or expired.`, 'JOB_NOT_FOUND');
    }

    res.json({
      success: true,
      job
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Cancel an active or queued job
 * DELETE /api/jobs/:id
 */
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    cancelJob(id);

    res.json({
      success: true,
      jobId: id,
      message: 'Job cancelled successfully.'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
