import { useState, useCallback, useRef, useEffect } from "react";

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

  const streamRef = useRef<MediaStream | null>(null);
  const initCountRef = useRef(0);

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
    console.log("[DEBUG] Cleanup called for stream:", mediaStream?.id);
    if (mediaStream) {
      const tracks = mediaStream.getTracks();
      console.log(
        "[DEBUG] Cleaning up tracks:",
        tracks.map((t) => ({ kind: t.kind, id: t.id, state: t.readyState }))
      );
      tracks.forEach((track) => {
        // Remove all event listeners
        const events = ["ended", "mute", "unmute"];
        events.forEach((event) => {
          track.removeEventListener(event, () => {});
        });

        // Ensure track is stopped
        if (track.readyState === "live") {
          track.stop();
          console.log("[DEBUG] Stopped track:", track.id);
        }

        // Remove from stream
        try {
          mediaStream.removeTrack(track);
          console.log("[DEBUG] Removed track from stream:", track.id);
        } catch (error) {
          console.warn("Error removing track:", error);
        }
      });
    }
  }, []);

  // Add this helper function to set up stream event listeners
  const setupStreamListeners = useCallback((mediaStream: MediaStream) => {
    mediaStream.getTracks().forEach((track) => {
      console.log(`Track added: ${track.kind}, enabled: ${track.enabled}`);

      const handleTrackEnded = () => {
        console.log(`${track.kind} track ended`);
        if (track.readyState === "ended") {
          setMediaError(`${track.kind} track ended unexpectedly`);
        }
      };

      track.addEventListener("ended", handleTrackEnded, { once: true });
      track.onended = handleTrackEnded;
    });
  }, []);

  const initializeMedia = useCallback(async () => {
    initCountRef.current++;
    const currentInitCount = initCountRef.current;
    console.log(`[DEBUG] Initialize media called (count: ${currentInitCount})`);

    try {
      // If we already have a valid stream with active tracks, return it
      if (
        streamRef.current &&
        streamRef.current
          .getTracks()
          .some((track) => track.readyState === "live")
      ) {
        console.log("[DEBUG] Reusing existing stream:", streamRef.current.id);
        return streamRef.current;
      }

      // Clean up any existing stream first
      if (streamRef.current) {
        console.log(
          "[DEBUG] Cleaning up existing stream:",
          streamRef.current.id
        );
        cleanupMediaStream(streamRef.current);
        streamRef.current = null;
      }

      // Try with video first
      try {
        console.log(
          "[DEBUG] Requesting media with constraints:",
          getMediaConstraints()
        );
        const mediaStream = await navigator.mediaDevices.getUserMedia(
          getMediaConstraints()
        );

        // Check if this initialization is still relevant
        if (currentInitCount !== initCountRef.current) {
          console.log("[DEBUG] Initialization superseded by newer call");
          cleanupMediaStream(mediaStream);
          return null;
        }

        console.log("[DEBUG] New stream created:", mediaStream.id);
        streamRef.current = mediaStream;
        setupStreamListeners(mediaStream);
        setStream(mediaStream);
        return mediaStream;
      } catch (videoError) {
        console.warn("Failed to get video, trying audio only:", videoError);

        // If video fails, try audio only
        try {
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            audio: getMediaConstraints().audio,
            video: false,
          });

          // Check if this initialization is still relevant
          if (currentInitCount !== initCountRef.current) {
            console.log(
              "[DEBUG] Audio-only initialization superseded by newer call"
            );
            cleanupMediaStream(audioOnlyStream);
            return null;
          }

          console.log("[DEBUG] Media access granted with audio only");
          streamRef.current = audioOnlyStream;
          setupStreamListeners(audioOnlyStream);
          setMediaState((prev) => ({ ...prev, isCameraOn: false }));
          setStream(audioOnlyStream);
          return audioOnlyStream;
        } catch (audioError) {
          console.error("Failed to get audio:", audioError);
          throw audioError;
        }
      }
    } catch (error) {
      console.error("Error initializing media:", error);
      setMediaError(
        error instanceof Error
          ? error.message
          : "Failed to initialize media devices"
      );
      return null;
    }
  }, [getMediaConstraints, cleanupMediaStream, setupStreamListeners]);

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

  // Update cleanup logging in the main useEffect
  useEffect(() => {
    console.log("[DEBUG] MediaDevices hook mounted");

    // Set up device change listener
    const handleDeviceChange = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      console.log("[DEBUG] Devices changed:", devices.length);
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      console.log("[DEBUG] MediaDevices hook unmounting");
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );

      if (streamRef.current) {
        console.log(
          "[DEBUG] Cleaning up stream on unmount:",
          streamRef.current.id
        );
        cleanupMediaStream(streamRef.current);
        streamRef.current = null;
      }
    };
  }, [cleanupMediaStream]);

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
