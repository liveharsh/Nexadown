/**
 * NEXADOWN - Media Analysis Route
 * POST /api/analyze
 */

const express = require('express');
let validateUrlMiddleware;
try {
  ({ validateUrlMiddleware } = require('../middleware/validateUrl'));
} catch (_) {
  try {
    ({ validateUrlMiddleware } = require('../src/middleware/validateUrl'));
  } catch (__) {
    validateUrlMiddleware = (req, res, next) => { req.validatedUrl = req.body?.url; next(); };
  }
}
const { getProviderForUrl } = require('../services/providers');
const { BadRequestError } = require('../utils/errors');

const router = express.Router();

router.post('/analyze', validateUrlMiddleware, async (req, res, next) => {
  try {
    const url = req.validatedUrl;
    const requestedPlatform = req.body?.platform;

    // Resolve dedicated provider
    const provider = getProviderForUrl(url);
    if (!provider) {
      throw new BadRequestError('No matching provider found for this domain.', 'NO_PROVIDER');
    }

    // Provider-level URL validation
    const validation = provider.validate(url);
    if (!validation.valid) {
      throw new BadRequestError(validation.error || 'Invalid URL structure for this platform.', 'INVALID_PROVIDER_URL');
    }

    console.log(`[Analyze] Analyzing ${provider.name} stream: ${url}`);
    const metadata = await provider.extract(url);

    res.json({
      success: true,
      platform: {
        id: provider.id,
        name: provider.name,
        icon: provider.icon,
        color: provider.color
      },
      data: metadata
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
