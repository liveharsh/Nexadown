/**
 * NEXADOWN - Standardized Error Handling Architecture
 * Defines custom error classes and formatting for consistent JSON API responses.
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Invalid request parameters.', code = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed for the supplied input.', code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please slow down and try again later.', code = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code);
  }
}

class UnsupportedPlatformError extends AppError {
  constructor(message = 'The provided URL is from an unsupported or unauthorized platform.', code = 'UNSUPPORTED_PLATFORM') {
    super(message, 400, code);
  }
}

class PlatformBlockedError extends AppError {
  constructor(message = 'The platform has restricted automated access or requires authentication.', code = 'PLATFORM_BLOCKED') {
    super(message, 403, code);
  }
}

class MediaUnavailableError extends AppError {
  constructor(message = 'The requested media is private, removed, or unavailable.', code = 'MEDIA_UNAVAILABLE') {
    super(message, 404, code);
  }
}

class JobCancelledError extends AppError {
  constructor(message = 'Processing job was cancelled by user.', code = 'JOB_CANCELLED') {
    super(message, 499, code);
  }
}

/**
 * Standardizes any error into a consistent JSON response body
 */
function formatErrorResponse(err) {
  const status = err.statusCode || (err.status && typeof err.status === 'number' ? err.status : 500);
  const code = err.code || (status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');
  const message = err.message || 'An unexpected error occurred on the server.';

  return {
    success: false,
    error: message,
    code,
    status
  };
}

/**
 * Express Global Error Handling Middleware
 */
function errorHandler(err, req, res, next) {
  const formatted = formatErrorResponse(err);
  if (formatted.status >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(`[Error ${formatted.code}]:`, err.message || err);
  }
  res.status(formatted.status).json(formatted);
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  UnsupportedPlatformError,
  PlatformBlockedError,
  MediaUnavailableError,
  JobCancelledError,
  formatErrorResponse,
  errorHandler
};
