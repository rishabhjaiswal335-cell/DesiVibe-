export type MediaBucket = 'avatars' | 'posts' | 'reels' | 'stories' | 'chat-media';

export interface UploadHandle {
  promise: Promise<{ url: string; bucket: string; size: number }>;
  abort: () => void;
}

export interface VideoCompressionResult {
  file: File;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
  durationSec: number;
}

export const IMAGE_FILTER_CSS: Record<string, string> = {
  Original: 'none',
  'Saffron Glow': 'contrast(1.08) saturate(1.25) sepia(0.18) brightness(1.03)',
  'Cyber Neon': 'contrast(1.18) saturate(1.4) hue-rotate(-8deg)',
  'Jaipur Warm': 'sepia(0.24) saturate(1.18) brightness(1.04)',
  Noir: 'grayscale(1) contrast(1.22)',
  Vivid: 'saturate(1.45) contrast(1.08)',
};

export function hasImageExtension(url?: string | null): boolean {
  if (!url) return false;
  return /\.(jpe?g|png|webp|gif|avif|svg)(\?|#|$)/i.test(url);
}

export function hasVideoExtension(url?: string | null): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i.test(url);
}

export function isVideoMedia(url?: string | null, mediaType?: string | null): boolean {
  if (!url) return false;
  if (hasVideoExtension(url)) return true;
  if (hasImageExtension(url)) return false;
  return mediaType === 'video' || mediaType === 'reel';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function compressImageFile(
  file: File,
  options: { maxWidth?: number; quality?: number; filterName?: string } = {}
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  const maxWidth = options.maxWidth ?? 1440;
  const quality = options.quality ?? 0.84;
  const filterCss = options.filterName ? IMAGE_FILTER_CSS[options.filterName] || 'none' : 'none';

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);

      ctx.filter = filterCss;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file);
          const outName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], outName, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function pickSupportedVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // Ignore unsupported mime check errors
    }
  }
  return null;
}

/**
 * Extracts a crisp JPEG cover frame from a local video File so grid thumbnails
 * (Profile, Explore, Saved) render immediately without broken video-in-img tags.
 */
export async function captureVideoThumbnailFile(file: File): Promise<File | null> {
  if (!file.type.startsWith('video/')) return null;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (result: File | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => finish(null), 5000);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    video.onloadeddata = () => {
      const targetTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(0.35, video.duration * 0.2)
        : 0;
      try {
        video.currentTime = targetTime;
      } catch {
        drawFrame();
      }
    };

    const drawFrame = () => {
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const maxDim = 720;
      const scale = Math.min(1, maxDim / Math.max(vw, vh));
      const width = Math.max(2, Math.round((vw * scale) / 2) * 2);
      const height = Math.max(2, Math.round((vh * scale) / 2) * 2);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return finish(null);

      ctx.drawImage(video, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return finish(null);
          const outName = file.name.replace(/\.[^.]+$/, '') + '_cover.jpg';
          finish(new File([blob], outName, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.84
      );
    };

    video.onseeked = drawFrame;
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/**
 * Client-side zero-COOP video optimizer (Canvas + MediaRecorder) that caps
 * resolution to 720p and bitrates for fast VibeReel delivery while preserving audio
 * and safely falling back to the original file if smaller or unsupported.
 */
export async function compressVideoFile(
  file: File,
  options: {
    maxDimension?: number;
    videoBitsPerSecond?: number;
    onProgress?: (percent: number) => void;
  } = {}
): Promise<VideoCompressionResult> {
  const originalSize = file.size;
  if (!file.type.startsWith('video/')) {
    return { file, compressed: false, originalSize, finalSize: originalSize, durationSec: 0 };
  }

  const mimeType = pickSupportedVideoMimeType();
  const maxDimension = options.maxDimension ?? 720;
  const videoBitsPerSecond = options.videoBitsPerSecond ?? 1_350_000;

  if (!mimeType || typeof document === 'undefined') {
    return { file, compressed: false, originalSize, finalSize: originalSize, durationSec: 0 };
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    let rafId = 0;
    let timeoutId = 0;
    let audioCtx: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (timeoutId) clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Ignore cleanup errors
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };

    const finish = (result: VideoCompressionResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      options.onProgress?.(100);
      resolve(result);
    };

    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    // Keep muted=false with AudioContext routed only to MediaStreamAudioDestinationNode
    // so speakers stay silent while audio tracks remain intact when supported.
    video.muted = true;

    video.onloadedmetadata = async () => {
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const longestSide = Math.max(vw, vh);

      // Skip re-encoding if file is already compact (<= 2.5 MB and <= 720p) or duration is unknown/very long
      if ((originalSize <= 2.5 * 1024 * 1024 && longestSide <= maxDimension) || durationSec > 90) {
        return finish({
          file,
          compressed: false,
          originalSize,
          finalSize: originalSize,
          durationSec,
        });
      }

      const scale = Math.min(1, maxDimension / Math.max(1, longestSide));
      const width = Math.max(2, Math.round((vw * scale) / 2) * 2);
      const height = Math.max(2, Math.round((vh * scale) / 2) * 2);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx || typeof canvas.captureStream !== 'function') {
        return finish({
          file,
          compressed: false,
          originalSize,
          finalSize: originalSize,
          durationSec,
        });
      }

      const canvasStream = canvas.captureStream(30);
      const combinedStream = new MediaStream(canvasStream.getVideoTracks());

      // Try capturing audio silently without audible speaker output
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          audioCtx = new AudioCtx();
          const source = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          video.muted = false;
          for (const track of dest.stream.getAudioTracks()) {
            combinedStream.addTrack(track);
          }
        }
      } catch {
        video.muted = true;
      }

      const chunks: Blob[] = [];
      try {
        recorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond,
          audioBitsPerSecond: 96_000,
        });
      } catch {
        return finish({
          file,
          compressed: false,
          originalSize,
          finalSize: originalSize,
          durationSec,
        });
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      recorder.onstop = () => {
        const cleanMime = mimeType.split(';')[0] || 'video/webm';
        const ext = cleanMime.includes('mp4') ? '.mp4' : '.webm';
        const blob = new Blob(chunks, { type: cleanMime });
        if (!blob.size || blob.size >= originalSize) {
          return finish({
            file,
            compressed: false,
            originalSize,
            finalSize: originalSize,
            durationSec,
          });
        }
        const outName = file.name.replace(/\.[^.]+$/, '') + `_opt${ext}`;
        const compressedFile = new File([blob], outName, { type: cleanMime });
        finish({
          file: compressedFile,
          compressed: true,
          originalSize,
          finalSize: compressedFile.size,
          durationSec,
        });
      };

      recorder.onerror = () => {
        finish({
          file,
          compressed: false,
          originalSize,
          finalSize: originalSize,
          durationSec,
        });
      };

      const maxTimeoutMs = Math.min(90_000, Math.max(15_000, (durationSec || 15) * 1400 + 6000));
      timeoutId = window.setTimeout(() => {
        try {
          if (recorder && recorder.state === 'recording') recorder.stop();
        } catch {
          finish({
            file,
            compressed: false,
            originalSize,
            finalSize: originalSize,
            durationSec,
          });
        }
      }, maxTimeoutMs);

      const renderFrame = () => {
        if (settled) return;
        if (!video.paused && !video.ended) {
          ctx.drawImage(video, 0, 0, width, height);
          if (durationSec > 0) {
            options.onProgress?.(Math.min(99, Math.round((video.currentTime / durationSec) * 100)));
          }
          rafId = requestAnimationFrame(renderFrame);
        }
      };

      video.onended = () => {
        ctx.drawImage(video, 0, 0, width, height);
        try {
          if (recorder && recorder.state === 'recording') recorder.stop();
        } catch {
          finish({
            file,
            compressed: false,
            originalSize,
            finalSize: originalSize,
            durationSec,
          });
        }
      };

      try {
        recorder.start(250);
        await video.play();
        rafId = requestAnimationFrame(renderFrame);
      } catch {
        try {
          if (recorder && recorder.state === 'recording') recorder.stop();
        } catch {
          // Ignore
        }
        finish({
          file,
          compressed: false,
          originalSize,
          finalSize: originalSize,
          durationSec,
        });
      }
    };

    video.onerror = () => {
      finish({
        file,
        compressed: false,
        originalSize,
        finalSize: originalSize,
        durationSec: 0,
      });
    };

    video.src = url;
  });
}

export function uploadMediaWithProgress(
  file: File,
  bucket: MediaBucket,
  token: string,
  onProgress: (percent: number) => void
): UploadHandle {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<{ url: string; bucket: string; size: number }>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    xhr.open('POST', `/api/media/upload?bucket=${encodeURIComponent(bucket)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve(data);
        } else {
          reject(new Error(data.error || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error('Invalid server response during upload.'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading media.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(form);
  });

  return {
    promise,
    abort: () => xhr.abort(),
  };
}
