/**
 * NEXADOWN - Facebook Media Provider Adapter
 */

const { extractMetadata } = require('../mediaProcessor');

class FacebookProvider {
  constructor() {
    this.name = 'Facebook';
    this.id = 'facebook';
    this.icon = 'facebook';
    this.color = '#1877f2';
  }

  matches(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com');
  }

  validate(url) {
    if (!this.matches(url)) {
      return { valid: false, error: 'Not a valid Facebook URL.' };
    }
    return { valid: true };
  }

  async extract(url) {
    const raw = await extractMetadata(url);

    const durationSec = raw.duration || 60;
    const minutes = Math.floor(durationSec / 60);
    const seconds = Math.floor(durationSec % 60).toString().padStart(2, '0');
    const durationFormatted = `${minutes}:${seconds}`;

    const videoOptions = [
      {
        id: 'video-hd',
        type: 'video',
        height: 1080,
        quality: '1080p HD',
        ext: 'mp4',
        label: 'Facebook HD Video (1080p)',
        badge: 'HD',
        estimatedSize: '~25 MB'
      },
      {
        id: 'video-sd',
        type: 'video',
        height: 720,
        quality: '720p SD',
        ext: 'mp4',
        label: 'Facebook Standard Video (720p)',
        badge: 'SD',
        estimatedSize: '~12 MB'
      }
    ];

    const audioOptions = [
      {
        id: 'audio-mp3-320',
        type: 'audio',
        audioFormat: 'mp3', ext: 'mp3',
        bitrate: '320k',
        label: 'MP3 Audio Stream (320 kbps)',
        badge: 'MP3',
        estimatedSize: '~5 MB'
      }
    ];

    return {
      id: raw.id || 'fb_media',
      title: raw.title || 'Facebook Video',
      uploader: raw.uploader || 'Facebook Creator',
      duration: durationSec,
      durationFormatted,
      thumbnail: raw.thumbnail || '',
      thumbnailUrl: raw.thumbnail || '',
      viewCount: 'Public Video',
      originalUrl: url,
      videoOptions,
      audioOptions,
      subtitlesList: []
    };
  }
}

module.exports = new FacebookProvider();
