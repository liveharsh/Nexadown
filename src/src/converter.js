const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const binDir = path.join(__dirname, '..', 'bin');
const tempDir = path.join(__dirname, '..', 'temp');

const isWindows = process.platform === 'win32';
let ffmpegPath = path.join(binDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  if (fs.existsSync(ffmpegInstaller.path)) {
    ffmpegPath = ffmpegInstaller.path;
  }
} catch (e) {}

/**
 * Converts a locally uploaded media file to the requested audio format
 */
function convertLocalAudio(inputFilePath, originalName, targetFormat, bitrate = '320k') {
  return new Promise((resolve, reject) => {
    const fileId = uuidv4();
    const baseName = path.parse(originalName).name.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const ext = targetFormat.toLowerCase();
    const outputFilename = `${baseName}_converted.${ext}`;
    const outputFilePath = path.join(tempDir, `${fileId}_${outputFilename}`);

    const args = ['-y', '-i', inputFilePath];

    if (ext === 'mp3') {
      args.push('-vn', '-c:a', 'libmp3lame', '-b:a', bitrate);
    } else if (ext === 'wav') {
      args.push('-vn', '-c:a', 'pcm_s16le');
    } else if (ext === 'm4a' || ext === 'aac') {
      args.push('-vn', '-c:a', 'aac', '-b:a', bitrate || '192k');
    } else if (ext === 'flac') {
      args.push('-vn', '-c:a', 'flac');
    } else if (ext === 'ogg') {
      args.push('-vn', '-c:a', 'libvorbis', '-q:a', '6');
    } else {
      args.push('-vn');
    }

    args.push(outputFilePath);

    console.log(`[FFmpeg] Converting ${originalName} to ${targetFormat} (${bitrate})...`);
    const child = spawn(ffmpegPath, args);

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      // Clean up input uploaded file
      try {
        if (fs.existsSync(inputFilePath)) {
          fs.unlinkSync(inputFilePath);
        }
      } catch (err) {}

      if (code !== 0) {
        return reject(new Error(`Conversion failed with exit code ${code}: ${stderr.slice(-300)}`));
      }

      if (!fs.existsSync(outputFilePath)) {
        return reject(new Error('Converted output file was not found.'));
      }

      resolve({
        filePath: outputFilePath,
        filename: outputFilename
      });
    });

    child.on('error', (err) => {
      try {
        if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
      } catch (e) {}
      reject(new Error(`Failed to launch FFmpeg: ${err.message}`));
    });
  });
}

module.exports = {
  convertLocalAudio
};
