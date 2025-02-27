import React, { useRef, useCallback, useEffect } from "react";

interface MediaPlayerProps {
  stream?: MediaStream;
}

export function MediaPlayer({ stream }: MediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.paused) return;
    if (playPromiseRef.current) {
      playPromiseRef.current.catch(() => null);
      playPromiseRef.current = null;
    }
    playPromiseRef.current = video.play().catch((err) => {
      if (err.name !== "AbortError") {
        console.warn("Video play failed:", err);
      }
    });
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      onLoadedMetadata={handleLoadedMetadata}
      className="w-full h-full object-cover"
    />
  );
}
