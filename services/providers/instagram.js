/**
 * NEXADOWN - Instagram Media Provider Adapter
 */

const { extractMetadata } = require('../mediaProcessor');

class InstagramProvider {
  constructor() {
    this.name = 'Instagram';
    this.id = 'instagram';
    this.icon = 'instagram';
    this.color = '#e1306c';
  }

  matches(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('instagram.com') || lower.includes('instagr.am');
  }

  validate(url) {
    if (!this.matches(url)) {
      return { valid: false, error: 'Not a valid Instagram URL.' };
    }
    const hasMedia = /\/(p|reel|reels|tv)\/[a-zA-Z0-9_-]+/.test(url);
    if (!hasMedia) {
      return { valid: false, error: 'Please provide a direct Instagram Reel, Post, or TV link.' };
    }
    return { valid: true };
  }

  async extract(url) {
    const raw = await extractMetadata(url);

    const durationSec = raw.duration || 30;
    const minutes = Math.floor(durationSec / 60);
    const seconds = Math.floor(durationSec % 60).toString().padStart(2, '0');
    const durationFormatted = `${minutes}:${seconds}`;

    const videoOptions = [
      {
        id: 'video-hd',
        type: 'video',
        height: 1080,
        quality: '1080p Original HD',
        ext: 'mp4',
        label: '1080p Instagram Reel / Post',
        badge: 'ORIGINAL',
        estimatedSize: '~15 MB'
      },
      {
        id: 'video-sd',
        type: 'video',
        height: 720,
        quality: '720p Mobile',
        ext: 'mp4',
        label: '720p Mobile Compressed',
        badge: '720P',
        estimatedSize: '~8 MB'
      }
    ];

    const audioOptions = [
      {
        id: 'audio-mp3-320',
        type: 'audio',
        audioFormat: 'mp3', ext: 'mp3',
        bitrate: '320k',
        label: 'Original Reel Audio (320 kbps MP3)',
        badge: 'STUDIO',
        estimatedSize: '~3.5 MB'
      }
    ];

    return {
      id: raw.id || 'ig_media',
      title: raw.title || raw.description?.slice(0, 60) || 'Instagram Media',
      uploader: raw.uploader || 'Instagram User',
      duration: durationSec,
      durationFormatted,
      thumbnail: raw.thumbnail || '',
      thumbnailUrl: raw.thumbnail || '',
      viewCount: 'Verified Reel',
      originalUrl: url,
      videoOptions,
      audioOptions,
      subtitlesList: []
    };
  }
}

module.exports = new InstagramProvider();
