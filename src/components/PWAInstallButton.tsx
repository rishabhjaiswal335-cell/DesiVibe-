import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        aria-label="Install DesiVibe Mobile App"
        className={
          compact
            ? 'w-11 h-11 rounded-full flex items-center justify-center text-[#00F0FF] hover:bg-white/10'
            : 'w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 border border-[#00F0FF]/40 text-xs font-semibold text-[#00F0FF] transition-colors'
        }
      >
        <Download size={compact ? 19 : 15} />
        {!compact && <span>Install Mobile App</span>}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        aria-label="Mobile App Install Guide"
        className={
          compact
            ? 'w-11 h-11 rounded-full flex items-center justify-center text-[#00F0FF] hover:bg-white/10'
            : 'w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/12 text-xs font-semibold text-white/85 transition-colors'
        }
      >
        <Smartphone size={compact ? 19 : 15} className="text-[#00F0FF]" />
        {!compact && <span>{isIOS ? 'Install on iPhone' : 'Get Mobile App'}</span>}
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-white flex items-center gap-2">
                <Smartphone size={18} className="text-[#00F0FF]" /> Install DesiVibe App
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install guide"
                className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70"
              >
                <X size={16} />
              </button>
            </div>
            {isIOS ? (
              <ol className="space-y-2 text-xs text-white/75 leading-relaxed">
                <li>1. Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.</li>
                <li>2. Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>3. Tap <strong>Add</strong> to launch DesiVibe full-screen like a native app.</li>
              </ol>
            ) : (
              <ol className="space-y-2 text-xs text-white/75 leading-relaxed">
                <li>1. Open your browser menu (⋮ in Chrome or Edge).</li>
                <li>2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                <li>3. Launch DesiVibe anytime from your phone&apos;s home screen with offline caching.</li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-4 left-4 right-4 sm:right-auto z-50 flex items-center gap-2 rounded-2xl bg-amber-500/95 px-4 py-2.5 text-xs font-semibold text-[#0A0A0F] shadow-xl">
      <WifiOff size={15} className="shrink-0" />
      <span>Offline Mode — Showing cached DesiVibe feed</span>
    </div>
  );
}
