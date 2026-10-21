/**
 * NEXADOWN - In-Memory Production Rate Limiting Middleware
 * Protects endpoints against brute-force and resource starvation attacks without external database dependencies.
 */

const { RateLimitError } = require('../utils/errors');

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000; // Default: 15 minutes
  const max = options.max || 120; // Default: 120 requests per window
  const message = options.message || 'Too many requests from this IP. Please try again later.';

  // Map of ip -> { count, resetTime }
  const clients = new Map();

  // Periodic cleanup every 5 minutes to release stale IP records
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of clients.entries()) {
      if (now > data.resetTime) {
        clients.delete(ip);
      }
    }
  }, 5 * 60 * 1000);

  // Unref interval so it does not prevent Node process termination during tests
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return function rateLimitMiddleware(req, res, next) {
    // Extract client IP address accurately (handling proxies like Render / Cloudflare)
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? forwarded.split(',')[0].trim()
      : (req.ip || req.connection?.remoteAddress || '127.0.0.1');

    const now = Date.now();
    let client = clients.get(ip);

    if (!client || now > client.resetTime) {
      client = {
        count: 1,
        resetTime: now + windowMs
      };
      clients.set(ip, client);
    } else {
      client.count += 1;
    }

    const remaining = Math.max(0, max - client.count);
    const resetSeconds = Math.ceil(client.resetTime / 1000);

    // Standard rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (client.count > max) {
      res.setHeader('Retry-After', Math.ceil((client.resetTime - now) / 1000));
      return next(new RateLimitError(message, 'RATE_LIMIT_EXCEEDED'));
    }

    next();
  };
}

module.exports = {
  createRateLimiter
};
