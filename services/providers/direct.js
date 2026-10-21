/**
 * NEXADOWN - Direct Media Stream Provider Adapter
 */

const path = require('path');

class DirectStreamProvider {
  constructor() {
    this.name = 'Direct Stream';
    this.id = 'direct';
    this.icon = 'videolink';
    this.color = '#00f5d4';
  }

  matches(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const ext = path.extname(parsed.pathname).toLowerCase();
      return ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.mp3', '.m4a', '.wav', '.flac', '.ogg'].includes(ext);
    } catch (_) {
      return false;
    }
  }

  validate(url) {
    if (!this.matches(url)) {
      return { valid: false, error: 'Not a direct media link.' };
    }
    return { valid: true };
  }

  async extract(url) {
    const parsed = new URL(url);
    const filename = path.basename(parsed.pathname) || 'media.mp4';
    const ext = path.extname(filename).toLowerCase().replace('.', '') || 'mp4';
    const isAudio = ['mp3', 'm4a', 'wav', 'flac', 'ogg'].includes(ext);

    return {
      id: 'direct_stream',
      title: filename,
      uploader: parsed.hostname,
      duration: 0,
      durationFormatted: 'Direct Stream',
      thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600',
      thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600',
      viewCount: 'Direct URL',
      originalUrl: url,
      videoOptions: isAudio ? [] : [
        {
          id: 'direct-video',
          type: 'video',
          height: 1080,
          quality: 'Original Stream',
          ext,
          label: `Direct Stream (${ext.toUpperCase()})`,
          badge: ext.toUpperCase(),
          estimatedSize: 'Direct Download',
          directUrl: url
        }
      ],
      audioOptions: [
        {
          id: 'direct-audio',
          type: 'audio',
          audioFormat: 'mp3', ext: 'mp3',
          bitrate: '320k',
          label: 'Extract Audio (320 kbps MP3)',
          badge: 'MP3',
          estimatedSize: '~8 MB',
          directUrl: isAudio ? url : null
        }
      ],
      subtitlesList: []
    };
  }
}

module.exports = new DirectStreamProvider();
