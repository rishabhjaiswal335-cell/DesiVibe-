import { Camera, Film, ImagePlus, MapPin, RefreshCw, Sparkles, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, getActiveToken } from '../lib/api.ts';
import {
  captureVideoThumbnailFile,
  compressImageFile,
  compressVideoFile,
  formatBytes,
  IMAGE_FILTER_CSS,
  uploadMediaWithProgress,
  type MediaBucket,
  type UploadHandle,
} from '../lib/media.ts';
import { getSupabaseSession } from '../lib/firebase.ts';
import type { PostItem } from '../types.ts';

interface CreateStudioModalProps {
  initialMode?: 'post' | 'story' | 'reel';
  onClose: () => void;
  onPublished: (type: 'post' | 'story' | 'reel', item?: PostItem) => void;
}

const HASHTAG_SUGGESTIONS = [
  '#DesiVibe',
  '#MumbaiNights',
  '#StreetFoodIndia',
  '#JaipurStyle',
  '#DesiMusic',
  '#TravelIndia',
  '#FestiveSeason',
  '#IndieCreator',
];

const STORY_STICKERS = ['Diwali', 'Mumbai', 'Live', 'Music', 'Foodie', 'On Tour'];

export function CreateStudioModal({ initialMode = 'reel', onClose, onPublished }: CreateStudioModalProps) {
  const [studioMode, setStudioMode] = useState<'reel' | 'video' | 'post' | 'carousel' | 'story'>(
    initialMode === 'story' ? 'story' : initialMode === 'post' ? 'post' : 'reel'
  );
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [filterName, setFilterName] = useState('Original');
  const [aspectRatio, setAspectRatio] = useState(initialMode === 'post' ? '4:5' : '9:16');
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [overlayText, setOverlayText] = useState('');
  const [stickers, setStickers] = useState<string[]>([]);
  const [audioTrackId, setAudioTrackId] = useState('track-tabla-synth');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('Uploading to DesiVibe Storage...');
  const [compressionNote, setCompressionNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const uploadHandleRef = useRef<UploadHandle | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      previews.forEach((u) => URL.revokeObjectURL(u));
      stopCamera();
    };
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const startCamera = async (mode: 'user' | 'environment' = facingMode) => {
    setError('');
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 60);
    } catch {
      setError('Camera permission denied or unavailable on this device. Use gallery upload instead.');
    }
  };

  const capturePhoto = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 1080;
    canvas.height = vid.videoHeight || 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
      addSelectedFiles([file]);
      stopCamera();
    }, 'image/jpeg', 0.9);
  };

  const addSelectedFiles = (selected: File[]) => {
    const maxCount = studioMode === 'carousel' ? 6 : 1;
    const next = studioMode === 'carousel' ? [...files, ...selected].slice(0, maxCount) : selected.slice(0, 1);
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
    setError('');
  };

  const handleCancelUpload = () => {
    uploadHandleRef.current?.abort();
    setUploading(false);
    setUploadProgress(0);
  };

  const handlePublish = async () => {
    if (files.length === 0) {
      return setError('Select or capture at least one photo or video.');
    }
    const token = getActiveToken();
    if (!token) return setError('Please sign in first.');

    setError('');
    setCompressionNote('');
    setUploading(true);
    setUploadProgress(0);

    try {
      const bucket: MediaBucket =
        studioMode === 'story' ? 'stories' : studioMode === 'reel' ? 'reels' : 'posts';

      const uploadedUrls: string[] = [];
      let coverThumbnailUrl = '';
      let videoMeta: { originalSize: number; finalSize: number; mimeType: string; durationSec: number } | null = null;

      for (let i = 0; i < files.length; i++) {
        let fileToUpload = files[i];
        if (fileToUpload.type.startsWith('image/')) {
          setUploadStage('Optimizing image...');
          fileToUpload = await compressImageFile(fileToUpload, {
            maxWidth: 1440,
            quality: 0.85,
            filterName,
          });
        } else if (fileToUpload.type.startsWith('video/')) {
          // Capture a crisp cover frame for grid previews before/alongside video upload
          if (i === 0 && studioMode !== 'story') {
            setUploadStage('Capturing cover frame...');
            const coverFile = await captureVideoThumbnailFile(fileToUpload);
            if (coverFile) {
              const coverUpload = uploadMediaWithProgress(coverFile, bucket, token, () => {});
              const coverRes = await coverUpload.promise.catch(() => null);
              if (coverRes?.url) coverThumbnailUrl = coverRes.url;
            }
          }

          setUploadStage('Optimizing video for fast delivery...');
          const compressed = await compressVideoFile(fileToUpload, {
            maxDimension: 720,
            videoBitsPerSecond: 1_350_000,
            onProgress: (pct) => {
              setUploadProgress(Math.round(pct * 0.35));
            },
          });
          fileToUpload = compressed.file;
          videoMeta = {
            originalSize: compressed.originalSize,
            finalSize: compressed.finalSize,
            mimeType: compressed.file.type,
            durationSec: compressed.durationSec,
          };
          if (compressed.compressed) {
            setCompressionNote(
              `Optimized ${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.finalSize)}`
            );
          }
        }

        setUploadStage('Uploading to DesiVibe Storage...');
        const handle = uploadMediaWithProgress(fileToUpload, bucket, token, (pct) => {
          const base = fileToUpload.type.startsWith('video/') ? 35 : 0;
          const span = fileToUpload.type.startsWith('video/') ? 55 : 90;
          const overall = Math.round(base + ((i + pct / 100) / files.length) * span);
          setUploadProgress(overall);
        });
        uploadHandleRef.current = handle;
        const res = await handle.promise;
        uploadedUrls.push(res.url);
      }

      setUploadProgress(95);
      setUploadStage('Finalizing...');

      if (studioMode === 'story') {
        await apiFetch('/api/stories', {
          method: 'POST',
          body: JSON.stringify({
            mediaUrl: uploadedUrls[0],
            mediaType: files[0].type.startsWith('video/') ? 'video' : 'image',
            overlayText,
            stickers,
          }),
        });
        setUploadProgress(100);
        onPublished('story');
        onClose();
        return;
      }

      const mediaType =
        studioMode === 'reel'
          ? 'reel'
          : studioMode === 'video' || files[0]?.type.startsWith('video/')
            ? 'video'
            : uploadedUrls.length > 1
              ? 'carousel'
              : 'image';

      const res = await apiFetch<{ post: PostItem }>('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          mediaType,
          mediaUrls: uploadedUrls,
          thumbnailUrl: coverThumbnailUrl || uploadedUrls[0],
          caption,
          location,
          aspectRatio,
          audioTrackId: mediaType === 'reel' ? audioTrackId : null,
          filterName,
        }),
      });

      // Notify transcode-reel Edge Function if Supabase is configured (fire-and-forget)
      if ((mediaType === 'reel' || mediaType === 'video') && videoMeta) {
        const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
        const sbSession = getSupabaseSession();
        if (supabaseUrl && anonKey) {
          fetch(`${supabaseUrl}/functions/v1/transcode-reel`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: anonKey,
              Authorization: `Bearer ${sbSession?.access_token || anonKey}`,
            },
            body: JSON.stringify({
              postId: res.post.id,
              bucket,
              objectPath: uploadedUrls[0],
              originalSize: videoMeta.originalSize,
              compressedSize: videoMeta.finalSize,
              mimeType: videoMeta.mimeType,
              durationSec: videoMeta.durationSec,
            }),
          }).catch(() => {});
        }
      }

      setUploadProgress(100);
      onPublished(mediaType === 'reel' ? 'reel' : 'post', res.post);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Upload failed. Tap Publish to retry.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="glass-panel rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl my-auto">
        {/* Studio Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} className="text-[#FF6B00]" />
            <h2 className="font-display text-lg font-bold text-white">DesiVibe Studio</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close studio"
            className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/75"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Format Tabs — VibeReel & Video First */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['reel', 'VibeReel'],
                ['video', 'Video'],
                ['post', 'Photo'],
                ['carousel', 'Carousel'],
                ['story', '24h Story'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setStudioMode(id);
                  setAspectRatio(id === 'story' || id === 'reel' ? '9:16' : id === 'video' ? '16:9' : '4:5');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  studioMode === id
                    ? 'vibe-gradient-cta text-white'
                    : 'bg-white/[0.04] text-white/70 hover:text-white border border-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between">
              <span>{error}</span>
              {files.length > 0 && !uploading && (
                <button type="button" onClick={handlePublish} className="underline font-semibold ml-3">
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Media Picker & Live Camera Preview */}
            <div className="space-y-3">
              {cameraOpen ? (
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/5] border border-white/15">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const next = facingMode === 'user' ? 'environment' : 'user';
                        setFacingMode(next);
                        startCamera(next);
                      }}
                      className="w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center"
                      aria-label="Flip camera"
                    >
                      <RefreshCw size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="w-14 h-14 rounded-full vibe-gradient-cta border-4 border-white text-white flex items-center justify-center"
                      aria-label="Capture photo"
                    >
                      <Camera size={22} />
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center"
                      aria-label="Close camera"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
              ) : previews.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/5] border border-white/15">
                    {files[0]?.type.startsWith('video/') ? (
                      <video src={previews[0]} controls className="w-full h-full object-cover" />
                    ) : (
                      <img
                        src={previews[0]}
                        alt="Upload preview"
                        style={{ filter: IMAGE_FILTER_CSS[filterName] || 'none' }}
                        className="w-full h-full object-cover"
                      />
                    )}
                    {studioMode === 'story' && overlayText && (
                      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center pointer-events-none">
                        <span className="inline-block px-4 py-2 rounded-2xl bg-black/60 text-white font-display font-semibold text-base">
                          {overlayText}
                        </span>
                      </div>
                    )}
                  </div>
                  {previews.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {previews.map((p, idx) => (
                        <img key={idx} src={p} alt={`Slide ${idx + 1}`} className="w-14 h-14 rounded-xl object-cover border border-white/15" />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/20 bg-white/[0.02] aspect-[4/5] flex flex-col items-center justify-center p-6 text-center space-y-4">
                  <UploadCloud size={36} className="text-[#00F0FF]" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {studioMode === 'reel' || studioMode === 'video'
                        ? 'Upload VibeReel or Video first'
                        : 'Drop photos or video here'}
                    </p>
                    <p className="text-xs text-white/50 mt-1">
                      MP4, WebM, MOV or Photos · Auto-optimized for DesiVibe
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <label className="px-4 py-2.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white cursor-pointer flex items-center gap-1.5">
                      {studioMode === 'reel' || studioMode === 'video' ? (
                        <>
                          <Film size={15} /> Upload Video / Reel
                        </>
                      ) : (
                        <>
                          <ImagePlus size={15} /> Gallery
                        </>
                      )}
                      <input
                        type="file"
                        multiple={studioMode === 'carousel'}
                        accept={studioMode === 'reel' || studioMode === 'video' ? 'video/*,image/*' : 'image/*,video/*'}
                        onChange={(e) => e.target.files && addSelectedFiles(Array.from(e.target.files))}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => startCamera()}
                      className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5"
                    >
                      <Camera size={15} /> Camera
                    </button>
                  </div>
                </div>
              )}

              {previews.length > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-[#00F0FF] cursor-pointer hover:underline">
                    Replace / Add Media
                    <input
                      type="file"
                      multiple={studioMode === 'carousel'}
                      accept="image/*,video/*"
                      onChange={(e) => e.target.files && addSelectedFiles(Array.from(e.target.files))}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setFiles([]);
                      setPreviews([]);
                    }}
                    className="text-xs text-white/55 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Editing Controls & Metadata */}
            <div className="space-y-4">
              {/* Filter presets */}
              {(!files[0] || files[0].type.startsWith('image/')) && (
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-2">Color Grade & Filter</label>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(IMAGE_FILTER_CSS).map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setFilterName(name)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          filterName === name
                            ? 'bg-[#FF6B00] text-white'
                            : 'bg-white/[0.05] text-white/70 hover:text-white'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Aspect Ratio */}
              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">Aspect Ratio</label>
                <div className="flex gap-2">
                  {['1:1', '4:5', '16:9', '9:16'].map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono-tabular ${
                        aspectRatio === ratio
                          ? 'bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]/40'
                          : 'bg-white/[0.04] text-white/60 border border-white/10'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              {studioMode === 'story' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1.5">Story Text Overlay</label>
                    <input
                      type="text"
                      value={overlayText}
                      onChange={(e) => setOverlayText(e.target.value)}
                      placeholder="Add text onto your 24h story..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-2">Stickers</label>
                    <div className="flex flex-wrap gap-1.5">
                      {STORY_STICKERS.map((s) => {
                        const active = stickers.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() =>
                              setStickers((prev) => (active ? prev.filter((x) => x !== s) : [...prev, s]))
                            }
                            className={`px-3 py-1 rounded-lg text-xs font-medium ${
                              active ? 'bg-[#FF007F] text-white' : 'bg-white/[0.05] text-white/70'
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1.5">Caption</label>
                    <textarea
                      rows={3}
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Share the story behind this moment..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white resize-none focus:outline-none focus:border-[#00F0FF]"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {HASHTAG_SUGGESTIONS.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setCaption((c) => (c ? `${c} ${tag}` : tag))}
                          className="text-[11px] text-[#00F0FF]/85 hover:text-[#00F0FF] px-2 py-0.5 rounded bg-[#00F0FF]/10"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1.5">Location</label>
                    <div className="relative">
                      <MapPin size={15} className="absolute left-3.5 top-3 text-white/40" />
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Bandra, Mumbai"
                        className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white"
                      />
                    </div>
                  </div>

                  {studioMode === 'reel' && (
                    <div>
                      <label className="block text-xs font-medium text-white/70 mb-1.5">Audio Track</label>
                      <div className="relative">
                        <Film size={15} className="absolute left-3.5 top-3 text-white/40" />
                        <select
                          value={audioTrackId}
                          onChange={(e) => setAudioTrackId(e.target.value)}
                          className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/12 text-sm text-white"
                        >
                          <option value="track-tabla-synth">Midnight Tabla Synth · Ananya Beats</option>
                          <option value="track-mumbai-rain">Marine Drive After Rain · Kabir LoFi</option>
                          <option value="track-jaipur-dusk">Sandstone Echoes · Rohan Collective</option>
                          <option value="track-chai-groove">Kulhad Morning Groove · Dev & The Boys</option>
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {uploading && (
                <div className="space-y-2 p-3 rounded-xl bg-white/[0.04] border border-white/10">
                  <div className="flex items-center justify-between text-xs text-white/80">
                    <span>{uploadStage}</span>
                    <span className="font-mono-tabular">{uploadProgress}%</span>
                  </div>
                  {compressionNote && (
                    <p className="text-[11px] text-[#00F0FF]">{compressionNote}</p>
                  )}
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full vibe-gradient transition-all duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <button type="button" onClick={handleCancelUpload} className="text-xs text-rose-400 hover:underline">
                    Cancel Upload
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handlePublish}
                disabled={uploading || files.length === 0}
                className="w-full py-3 px-4 rounded-xl vibe-gradient-cta text-white text-sm font-semibold hover:opacity-95 disabled:opacity-45"
              >
                {uploading
                  ? 'Publishing...'
                  : studioMode === 'story'
                    ? 'Publish 24h Story'
                    : studioMode === 'reel'
                      ? 'Publish VibeReel'
                      : 'Publish Post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
