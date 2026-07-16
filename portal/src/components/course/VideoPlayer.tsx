import { useRef, useEffect, useCallback, useState } from 'react';
import Hls from 'hls.js';

interface VideoPlayerProps {
  readonly streamUid: string;
  readonly initialSeconds?: number;
  readonly onTimeUpdate?: (currentSeconds: number, duration: number) => void;
}

interface SignedUrlResponse {
  readonly hlsUrl: string;
  readonly expiresAt: number;
}

async function fetchSignedUrl(streamUid: string): Promise<SignedUrlResponse> {
  const token = localStorage.getItem('portal_token');
  if (!token) throw new Error('Not signed in');

  const res = await fetch(`/api/stream-token?uid=${encodeURIComponent(streamUid)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load video (${res.status})`);
  }

  return res.json();
}

export default function VideoPlayer({ streamUid, initialSeconds = 0, onTimeUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hasSeeked = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset seek state when the video changes
  useEffect(() => {
    hasSeeked.current = false;
  }, [streamUid]);

  // Fetch signed URL + attach (HLS via hls.js, or native HLS in Safari).
  // Tear down hls instance + listeners on unmount or streamUid change.
  useEffect(() => {
    if (!streamUid) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { hlsUrl } = await fetchSignedUrl(streamUid);
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;

        // Tear down any prior hls instance before attaching a new one
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hlsRef.current = hls;
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) setError('Playback error. Refresh and try again.');
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS (Safari, iOS)
          video.src = hlsUrl;
        } else {
          throw new Error('This browser does not support HLS playback');
        }

        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load video');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUid]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasSeeked.current) return;
    if (initialSeconds > 0 && initialSeconds < video.duration * 0.95) {
      video.currentTime = initialSeconds;
    }
    hasSeeked.current = true;
  }, [initialSeconds]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !onTimeUpdate) return;
    onTimeUpdate(video.currentTime, video.duration);
  }, [onTimeUpdate]);

  if (!streamUid) {
    return (
      <div className="lp-video-ph">
        <p>Video coming soon</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lp-video-ph">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="lp-video" style={{ position: 'relative' }}>
      {loading && (
        <div
          className="lp-video-ph"
          style={{ position: 'absolute', inset: 0, zIndex: 1, aspectRatio: 'unset' }}
        >
          <p>Loading…</p>
        </div>
      )}
      <video
        ref={videoRef}
        controls
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
      >
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
