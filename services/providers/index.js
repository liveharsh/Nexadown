/**
 * NEXADOWN - Platform Provider Registry
 */

const youtubeProvider = require('./youtube');
const instagramProvider = require('./instagram');
const facebookProvider = require('./facebook');
const tiktokProvider = require('./tiktok');
const directProvider = require('./direct');
const { extractMetadata } = require('../mediaProcessor');

const providers = [
  youtubeProvider,
  instagramProvider,
  facebookProvider,
  tiktokProvider,
  directProvider
];

/**
 * Fallback Generic Provider for other authorized platforms (Twitter/X, Vimeo, Reddit, SoundCloud, etc.)
 */
const genericProvider = {
  name: 'Universal Core',
  id: 'universal',
  icon: 'videolink',
  color: '#00f2fe',
  matches: () => true,
  validate: () => ({ valid: true }),
  extract: async (url) => {
    const raw = await extractMetadata(url);
    const durationSec = raw.duration || 60;
    const minutes = Math.floor(durationSec / 60);
    const seconds = Math.floor(durationSec % 60).toString().padStart(2, '0');

    return {
      id: raw.id || 'media',
      title: raw.title || 'Extracted Media',
      uploader: raw.uploader || 'Creator',
      duration: durationSec,
      durationFormatted: `${minutes}:${seconds}`,
      thumbnail: raw.thumbnail || '',
      thumbnailUrl: raw.thumbnail || '',
      viewCount: 'Verified Stream',
      originalUrl: url,
      videoOptions: [
        {
          id: 'video-best',
          type: 'video',
          height: 1080,
          quality: 'Best Quality',
          ext: 'mp4',
          label: 'Original Video Stream (MP4)',
          badge: 'MP4',
          estimatedSize: '~20 MB'
        }
      ],
      audioOptions: [
        {
          id: 'audio-best',
          type: 'audio',
          audioFormat: 'mp3', ext: 'mp3',
          bitrate: '320k',
          label: 'Extracted Audio (320 kbps MP3)',
          badge: 'MP3',
          estimatedSize: '~5 MB'
        }
      ],
      subtitlesList: []
    };
  }
};

/**
 * Finds the dedicated provider matching the given URL
 */
function getProviderForUrl(url) {
  if (!url) return null;
  for (const provider of providers) {
    if (provider.matches(url)) {
      return provider;
    }
  }
  return genericProvider;
}

module.exports = {
  providers,
  getProviderForUrl,
  genericProvider
};
