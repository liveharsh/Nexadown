const dns = require('dns').promises;
const { URL } = require('url');

/**
 * Checks if an IPv4 address is in a private/internal range
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
  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8
  if (parts[0] === 0) return true;
  // 100.64.0.0/10 (Shared address space)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  return false;
}

/**
 * Checks if an IPv6 address is internal/loopback
 */
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local
  if (normalized.startsWith('fe80')) return true; // Link-local
  return false;
}

/**
 * Validates a media URL against SSRF and illegal schemes
 */
async function validateMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return { valid: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Deny explicit localhost names and common internal names
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    'metadata.google.internal',
    'instance-data',
    'internal'
  ];

  if (blockedHosts.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, error: 'Internal/private endpoints are strictly forbidden.' };
  }

  // Resolve hostname via DNS to check IP for SSRF prevention
  try {
    const lookup = await dns.lookup(hostname);
    const ip = lookup.address;

    if (lookup.family === 4 && isPrivateIPv4(ip)) {
      return { valid: false, error: 'Target resolves to a restricted private IPv4 address.' };
    }
    if (lookup.family === 6 && isPrivateIPv6(ip)) {
      return { valid: false, error: 'Target resolves to a restricted private IPv6 address.' };
    }
  } catch (dnsErr) {
    // If DNS resolution fails, the host is not reachable on the public internet
    return { valid: false, error: `Could not resolve hostname '${hostname}'. Please check the URL.` };
  }

  return { valid: true, parsedUrl: parsed.href, hostname };
}

/**
 * Detects the source platform from the hostname
 */
function detectPlatform(hostname) {
  const host = hostname.toLowerCase();
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    return { name: 'YouTube', icon: 'youtube', color: '#ff0033' };
  }
  if (host.includes('instagram.com')) {
    return { name: 'Instagram', icon: 'instagram', color: '#e1306c' };
  }
  if (host.includes('tiktok.com')) {
    return { name: 'TikTok', icon: 'music', color: '#00f2fe' };
  }
  if (host.includes('twitter.com') || host.includes('x.com')) {
    return { name: 'Twitter / X', icon: 'twitter', color: '#1da1f2' };
  }
  if (host.includes('facebook.com') || host.includes('fb.watch')) {
    return { name: 'Facebook', icon: 'facebook', color: '#1877f2' };
  }
  if (host.includes('soundcloud.com')) {
    return { name: 'SoundCloud', icon: 'headphones', color: '#ff5500' };
  }
  if (host.includes('spotify.com') || host.includes('spotify.link')) {
    return { name: 'Spotify Music', icon: 'headphones', color: '#1db954' };
  }
  if (host.includes('pinterest.com') || host.includes('pin.it')) {
    return { name: 'Pinterest', icon: 'link', color: '#e60023' };
  }
  if (host.includes('reddit.com') || host.includes('redd.it')) {
    return { name: 'Reddit Media', icon: 'video', color: '#ff4500' };
  }
  if (host.includes('twitch.tv')) {
    return { name: 'Twitch Clip', icon: 'video', color: '#9146ff' };
  }
  if (host.includes('dailymotion.com') || host.includes('dai.ly')) {
    return { name: 'Dailymotion', icon: 'video', color: '#0066dc' };
  }
  if (host.includes('bandcamp.com')) {
    return { name: 'Bandcamp', icon: 'headphones', color: '#629aa9' };
  }
  if (host.includes('mixcloud.com')) {
    return { name: 'Mixcloud', icon: 'headphones', color: '#52aad8' };
  }
  return { name: 'Universal Direct Media Link', icon: 'link', color: '#00f5d4' };
}

module.exports = {
  validateMediaUrl,
  detectPlatform
};
