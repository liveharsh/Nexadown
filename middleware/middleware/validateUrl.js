/**
 * NEXADOWN - URL Validation & Anti-SSRF Security Middleware
 * Restricts requests strictly to authorized domains and blocks internal network targets.
 */

const dns = require('dns').promises;
const { URL } = require('url');
const { BadRequestError, UnsupportedPlatformError } = require('../utils/errors');

/**
 * Checks if an IPv4 address falls inside a private, loopback, or link-local range
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;
  // 10.0.0.0/8 (Private)
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (Private)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata service)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8
  if (parts[0] === 0) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  return false;
}

/**
 * Checks if an IPv6 address is internal, loopback, or link-local
 */
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local
  if (normalized.startsWith('fe80')) return true; // Link-local
  return false;
}

/**
 * Supported Domain Suffixes Allowlist
 */
const ALLOWED_DOMAIN_PATTERNS = [
  /^(.*\.)?youtube\.com$/i,
  /^youtu\.be$/i,
  /^(.*\.)?instagram\.com$/i,
  /^instagr\.am$/i,
  /^(.*\.)?facebook\.com$/i,
  /^(.*\.)?fb\.watch$/i,
  /^fb\.com$/i,
  /^(.*\.)?tiktok\.com$/i,
  /^(.*\.)?spotify\.com$/i,
  /^(.*\.)?soundcloud\.com$/i,
  /^(.*\.)?twitter\.com$/i,
  /^(.*\.)?x\.com$/i,
  /^(.*\.)?vimeo\.com$/i,
  /^(.*\.)?reddit\.com$/i,
  /^(.*\.)?twitch\.tv$/i,
  /^(.*\.)?dailymotion\.com$/i
];

/**
 * Recognized Direct Media File Extensions
 */
const DIRECT_MEDIA_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.mp3', '.m4a', '.wav', '.flac', '.ogg'];

/**
 * Performs comprehensive SSRF and domain validation on a media URL string
 */
async function validateMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new BadRequestError('URL must be a non-empty string.', 'EMPTY_URL');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    throw new BadRequestError('Malformed URL. Please provide a valid HTTP or HTTPS address.', 'MALFORMED_URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestError('Unsupported protocol. Only HTTP and HTTPS are permitted.', 'INVALID_PROTOCOL');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Deny explicit localhost names and common internal names
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254',
    'metadata.google.internal',
    'instance-data',
    'internal'
  ];

  if (blockedHosts.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new BadRequestError('Access to internal, loopback, or cloud metadata endpoints is prohibited.', 'SSRF_BLOCKED');
  }

  // Check if domain is in allowlist or has a direct media extension
  const pathname = parsed.pathname.toLowerCase();
  const isDirectMedia = DIRECT_MEDIA_EXTENSIONS.some(ext => pathname.endsWith(ext));
  const isAllowedDomain = ALLOWED_DOMAIN_PATTERNS.some(pattern => pattern.test(hostname));

  if (!isAllowedDomain && !isDirectMedia) {
    throw new UnsupportedPlatformError(
      `The host '${hostname}' is not supported. Supported platforms include YouTube, Instagram, Facebook, TikTok, Spotify, SoundCloud, Twitter/X, and direct media streams.`,
      'DOMAIN_NOT_ALLOWED'
    );
  }

  // Resolve hostname via DNS to prevent DNS rebinding SSRF
  try {
    const lookup = await dns.lookup(hostname);
    const ip = lookup.address;

    if (lookup.family === 4 && isPrivateIPv4(ip)) {
      throw new BadRequestError('Destination resolves to a restricted private or local IPv4 network.', 'SSRF_PRIVATE_IP');
    }
    if (lookup.family === 6 && isPrivateIPv6(ip)) {
      throw new BadRequestError('Destination resolves to a restricted private or local IPv6 network.', 'SSRF_PRIVATE_IP');
    }
  } catch (dnsErr) {
    if (dnsErr instanceof BadRequestError || dnsErr instanceof UnsupportedPlatformError) {
      throw dnsErr;
    }
    throw new BadRequestError(`Could not resolve host '${hostname}'. Check the URL or host connectivity.`, 'DNS_LOOKUP_FAILED');
  }

  return {
    valid: true,
    parsedUrl: parsed.href,
    hostname,
    isDirectMedia
  };
}

/**
 * Express middleware that validates req.body.url or req.query.url
 */
async function validateUrlMiddleware(req, res, next) {
  try {
    const url = req.body?.url || req.query?.url;
    const validated = await validateMediaUrl(url);
    req.validatedUrl = validated.parsedUrl;
    req.targetHostname = validated.hostname;
    req.isDirectMedia = validated.isDirectMedia;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  validateMediaUrl,
  validateUrlMiddleware,
  isPrivateIPv4,
  isPrivateIPv6,
  ALLOWED_DOMAIN_PATTERNS
};
