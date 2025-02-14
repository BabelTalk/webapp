import { useState, useCallback, useRef } from "react";

interface MediaState {
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isBackCamera: boolean;
}

interface MediaSettings {
  audio: {
    noiseSuppression: boolean;
    echoCancellation: boolean;
  };
  video: {
    sendResolution: string;
    frameRate: number;
  };
}

export function useMediaDevices(settings: MediaSettings) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [mediaState, setMediaState] = useState<MediaState>({
    isMicOn: true,
    isCameraOn: true,
    isScreenSharing: false,
    isBackCamera: false,
  });
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [originalVideoTrack, setOriginalVideoTrack] =
    useState<MediaStreamTrack | null>(null);

  const getMediaConstraints = useCallback(() => {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: settings.audio.echoCancellation,
        noiseSuppression: settings.audio.noiseSuppression,
      },
      video: {
        facingMode: mediaState.isBackCamera ? "environment" : "user",
        width:
          settings.video.sendResolution === "1080p"
            ? { ideal: 1920 }
            : settings.video.sendResolution === "720p"
            ? { ideal: 1280 }
            : { ideal: 854 },
        height:
          settings.video.sendResolution === "1080p"
            ? { ideal: 1080 }
            : settings.video.sendResolution === "720p"
            ? { ideal: 720 }
            : { ideal: 480 },
        frameRate: { max: settings.video.frameRate },
      },
    };
    return constraints;
  }, [settings, mediaState.isBackCamera]);

  const cleanupMediaStream = useCallback((mediaStream: MediaStream | null) => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => {
        track.stop();
        mediaStream.removeTrack(track);
      });
    }
  }, []);

  const initializeMedia = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia(
        getMediaConstraints()
      );
      setStream(mediaStream);
      return mediaStream;
    } catch (error) {
      console.error("Error initializing media:", error);
      setMediaError("Failed to initialize media devices");
      return null;
    }
  }, [getMediaConstraints]);

  const toggleMic = useCallback(() => {
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mediaState.isMicOn;
      });
      setMediaState((prev) => ({ ...prev, isMicOn: !prev.isMicOn }));
    }
  }, [stream, mediaState.isMicOn]);

  const toggleCamera = useCallback(() => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !mediaState.isCameraOn;
      });
      setMediaState((prev) => ({ ...prev, isCameraOn: !prev.isCameraOn }));
    }
  }, [stream, mediaState.isCameraOn]);

  const switchCamera = useCallback(async () => {
    if (!stream) return;

    try {
      // Stop and cleanup old video tracks
      const oldVideoTracks = stream.getVideoTracks();
      oldVideoTracks.forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });

      // Toggle back camera state
      setMediaState((prev) => ({ ...prev, isBackCamera: !prev.isBackCamera }));

      // Get new stream with different camera
      const newStream = await navigator.mediaDevices.getUserMedia(
        getMediaConstraints()
      );
      const newVideoTrack = newStream.getVideoTracks()[0];

      // Stop tracks from the temporary new stream
      newStream.getAudioTracks().forEach((track) => {
        track.stop();
        newStream.removeTrack(track);
      });

      // Add the new video track to the existing stream
      stream.addTrack(newVideoTrack);

      return newVideoTrack;
    } catch (error) {
      console.error("Error switching camera:", error);
      setMediaError("Failed to switch camera. Please try again.");
      return null;
    }
  }, [stream, getMediaConstraints]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (!mediaState.isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: settings.audio.noiseSuppression,
        });

        if (stream) {
          // Store original video track
          const originalTrack = stream.getVideoTracks()[0] || null;
          setOriginalVideoTrack(originalTrack);

          // Replace video track
          const videoTrack = screenStream.getVideoTracks()[0];
          const oldVideoTracks = stream.getVideoTracks();
          oldVideoTracks.forEach((track) => {
            track.stop();
            stream.removeTrack(track);
          });
          stream.addTrack(videoTrack);

          // Add stop handler
          videoTrack.onended = () => {
            stopScreenSharing();
          };
        }

        setScreenStream(screenStream);
        setMediaState((prev) => ({ ...prev, isScreenSharing: true }));
      } else {
        await stopScreenSharing();
      }
    } catch (error) {
      console.error("Error toggling screen share:", error);
      setMediaError("Failed to toggle screen share");
    }
  }, [stream, mediaState.isScreenSharing, settings.audio.noiseSuppression]);

  const stopScreenSharing = useCallback(async () => {
    if (!stream || !screenStream) return;

    try {
      // Cleanup screen stream
      cleanupMediaStream(screenStream);

      // Restore original video track
      if (originalVideoTrack) {
        const oldVideoTracks = stream.getVideoTracks();
        oldVideoTracks.forEach((track) => {
          track.stop();
          stream.removeTrack(track);
        });
        stream.addTrack(originalVideoTrack);
      }

      setScreenStream(null);
      setMediaState((prev) => ({ ...prev, isScreenSharing: false }));
      setOriginalVideoTrack(null);
    } catch (error) {
      console.error("Error stopping screen share:", error);
      setMediaError("Failed to stop screen share");
    }
  }, [stream, screenStream, originalVideoTrack, cleanupMediaStream]);

  return {
    stream,
    screenStream,
    mediaState,
    mediaError,
    initializeMedia,
    toggleMic,
    toggleCamera,
    switchCamera,
    toggleScreenShare,
    stopScreenSharing,
    cleanupMediaStream,
    setMediaError,
  };
}
