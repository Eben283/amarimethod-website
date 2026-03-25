import { useRef, useEffect, useCallback } from 'react';

interface VideoPlayerProps {
  readonly videoUrl: string;
  readonly initialSeconds?: number;
  readonly onTimeUpdate?: (currentSeconds: number, duration: number) => void;
}

export default function VideoPlayer({ videoUrl, initialSeconds = 0, onTimeUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasSeeked = useRef(false);

  // Seek to saved position on first load
  useEffect(() => {
    hasSeeked.current = false;
  }, [videoUrl]);

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

  if (!videoUrl) {
    return (
      <div className="w-full aspect-video bg-amari-light-sand rounded-xl flex items-center justify-center">
        <p className="text-sm text-amari-text-muted font-sans">
          Video coming soon
        </p>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={videoUrl}
      controls
      playsInline
      className="w-full aspect-video bg-black rounded-xl"
      onLoadedMetadata={handleLoadedMetadata}
      onTimeUpdate={handleTimeUpdate}
    >
      Your browser does not support the video tag.
    </video>
  );
}
