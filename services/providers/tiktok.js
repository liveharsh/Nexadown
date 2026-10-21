/**
 * NEXADOWN - TikTok Media Provider Adapter
 */

const { extractMetadata } = require('../mediaProcessor');

class TikTokProvider {
  constructor() {
    this.name = 'TikTok';
    this.id = 'tiktok';
    this.icon = 'tiktok';
    this.color = '#00f2fe';
  }

  matches(url) {
    if (!url) return false;
    return url.toLowerCase().includes('tiktok.com');
  }

  validate(url) {
    if (!this.matches(url)) {
      return { valid: false, error: 'Not a valid TikTok URL.' };
    }
    return { valid: true };
  }

  async extract(url) {
    const raw = await extractMetadata(url);

    const durationSec = raw.duration || 15;
    const minutes = Math.floor(durationSec / 60);
    const seconds = Math.floor(durationSec % 60).toString().padStart(2, '0');
    const durationFormatted = `${minutes}:${seconds}`;

    const videoOptions = [
      {
        id: 'video-clean',
        type: 'video',
        height: 1080,
        quality: 'Original Clean HD',
        ext: 'mp4',
        label: 'TikTok Clean Video (No Watermark)',
        badge: 'CLEAN',
        estimatedSize: '~12 MB'
      }
    ];

    const audioOptions = [
      {
        id: 'audio-mp3-320',
        type: 'audio',
        audioFormat: 'mp3',
        bitrate: '320k',
        label: 'Original TikTok Audio (320 kbps MP3)',
        badge: 'AUDIO',
        estimatedSize: '~2.5 MB'
      }
    ];

    return {
      id: raw.id || 'tiktok_media',
      title: raw.title || raw.description || 'TikTok Video',
      uploader: raw.uploader || 'TikTok Creator',
      duration: durationSec,
      durationFormatted,
      thumbnail: raw.thumbnail || '',
      thumbnailUrl: raw.thumbnail || '',
      viewCount: 'Verified Video',
      originalUrl: url,
      videoOptions,
      audioOptions,
      subtitlesList: []
    };
  }
}

module.exports = new TikTokProvider();
