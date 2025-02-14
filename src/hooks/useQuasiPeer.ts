import { useEffect, useRef, useState, useCallback } from "react";
import { Device } from "mediasoup-client";
import { io, Socket } from "socket.io-client";
import { ParticipantRole } from "@/types/quasiPeer";
import type {
  TranscriptionResult,
  TranslationResult,
  Participant,
  ConnectionInfo,
} from "@/types/quasiPeer";

interface UseQuasiPeerOptions {
  meetingId: string;
  userName: string;
  preferredLanguage: string;
  onTranscriptionResult?: (result: TranscriptionResult) => void;
  onTranslationResult?: (result: TranslationResult) => void;
  onParticipantJoined?: (participant: Participant) => void;
  onParticipantLeft?: (participantId: string) => void;
}

interface MediaState {
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
}

export function useQuasiPeer({
  meetingId,
  userName,
  preferredLanguage,
  onTranscriptionResult,
  onTranslationResult,
  onParticipantJoined,
  onParticipantLeft,
}: UseQuasiPeerOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mediaState, setMediaState] = useState<MediaState>({
    isMicOn: true,
    isCameraOn: true,
    isScreenSharing: false,
  });

  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const producerTransportRef = useRef<any>(null);
  const consumerTransportRef = useRef<any>(null);
  const producersRef = useRef<Map<string, any>>(new Map());
  const consumersRef = useRef<Map<string, any>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize connection to QuasiPeer server
  const connect = useCallback(
    async (stream: MediaStream) => {
      try {
        // Store the stream
        streamRef.current = stream;

        // Connect to signaling server
        socketRef.current = io(process.env.NEXT_PUBLIC_QUASI_PEER_URL || "", {
          transports: ["websocket"],
        });

        // Create mediasoup Device
        deviceRef.current = new Device();

        // Socket event handlers
        socketRef.current.on("connect", () => {
          setIsConnected(true);

          // Join the meeting
          socketRef.current?.emit("join-meeting", {
            meetingId,
            participantInfo: {
              preferredLanguage,
              role: ParticipantRole.PARTICIPANT,
              connectionInfo: {
                userAgent: navigator.userAgent,
                bandwidth: 1000000, // Default bandwidth
                latency: 0, // Will be measured
              } as ConnectionInfo,
            },
          });
        });

        // Handle router RTP capabilities
        socketRef.current.on(
          "router-rtp-capabilities",
          async (routerRtpCapabilities) => {
            try {
              await deviceRef.current?.load({ routerRtpCapabilities });
              await createSendTransport();
              await createRecvTransport();
            } catch (error) {
              console.error("Failed to load device:", error);
              setError("Failed to initialize media device");
            }
          }
        );

        // Handle participant updates
        socketRef.current.on(
          "participant-joined",
          (participant: Participant) => {
            setParticipants((prev) => [...prev, participant]);
            onParticipantJoined?.(participant);
          }
        );

        socketRef.current.on("participant-left", (participantId: string) => {
          setParticipants((prev) => prev.filter((p) => p.id !== participantId));
          onParticipantLeft?.(participantId);
        });

        // Handle AI results
        socketRef.current.on(
          "transcription-result",
          (result: TranscriptionResult) => {
            onTranscriptionResult?.(result);
          }
        );

        socketRef.current.on(
          "translation-result",
          (result: TranslationResult) => {
            onTranslationResult?.(result);
          }
        );
      } catch (error) {
        console.error("Failed to connect:", error);
        setError("Failed to connect to meeting server");
      }
    },
    [meetingId, userName, preferredLanguage]
  );

  // Create WebRTC transport for sending media
  const createSendTransport = async () => {
    try {
      socketRef.current?.emit(
        "create-transport",
        { type: "send" },
        async (response: any) => {
          if (response.error) {
            throw new Error(response.error);
          }

          producerTransportRef.current = deviceRef.current?.createSendTransport(
            response.transport
          );

          // Handle transport connection
          producerTransportRef.current?.on(
            "connect",
            ({ dtlsParameters }: any, callback: () => void) => {
              socketRef.current?.emit(
                "connect-transport",
                {
                  transportId: producerTransportRef.current.id,
                  dtlsParameters,
                },
                callback
              );
            }
          );

          // Handle transport produce
          producerTransportRef.current?.on(
            "produce",
            async (
              { kind, rtpParameters }: any,
              callback: (id: string) => void
            ) => {
              socketRef.current?.emit(
                "produce",
                {
                  transportId: producerTransportRef.current.id,
                  kind,
                  rtpParameters,
                },
                callback
              );
            }
          );

          // Start producing audio/video
          await produceMedia();
        }
      );
    } catch (error) {
      console.error("Failed to create send transport:", error);
      setError("Failed to create media transport");
    }
  };

  // Create WebRTC transport for receiving media
  const createRecvTransport = async () => {
    try {
      socketRef.current?.emit(
        "create-transport",
        { type: "recv" },
        async (response: any) => {
          if (response.error) {
            throw new Error(response.error);
          }

          consumerTransportRef.current = deviceRef.current?.createRecvTransport(
            response.transport
          );

          // Handle transport connection
          consumerTransportRef.current?.on(
            "connect",
            ({ dtlsParameters }: any, callback: () => void) => {
              socketRef.current?.emit(
                "connect-transport",
                {
                  transportId: consumerTransportRef.current.id,
                  dtlsParameters,
                },
                callback
              );
            }
          );
        }
      );
    } catch (error) {
      console.error("Failed to create receive transport:", error);
      setError("Failed to create media transport");
    }
  };

  // Start producing media streams
  const produceMedia = async () => {
    if (!streamRef.current || !producerTransportRef.current) return;

    try {
      // Produce audio
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        const audioProducer = await producerTransportRef.current.produce({
          track: audioTrack,
          codecOptions: {
            opusStereo: true,
            opusDtx: true,
          },
        });
        producersRef.current.set("audio", audioProducer);
      }

      // Produce video
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const videoProducer = await producerTransportRef.current.produce({
          track: videoTrack,
          encodings: [
            { maxBitrate: 100000, scaleResolutionDownBy: 4 },
            { maxBitrate: 300000, scaleResolutionDownBy: 2 },
            { maxBitrate: 900000, scaleResolutionDownBy: 1 },
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
        });
        producersRef.current.set("video", videoProducer);
      }
    } catch (error) {
      console.error("Failed to produce media:", error);
      setError("Failed to start media streaming");
    }
  };

  // Media control functions
  const toggleMic = useCallback(() => {
    if (!streamRef.current) return;

    const audioProducer = producersRef.current.get("audio");
    if (audioProducer) {
      audioProducer.pause();
      streamRef.current
        .getAudioTracks()
        .forEach((track) => (track.enabled = !mediaState.isMicOn));
      setMediaState((prev) => ({ ...prev, isMicOn: !prev.isMicOn }));

      socketRef.current?.emit("producer-pause", {
        producerId: audioProducer.id,
      });
    }
  }, [mediaState.isMicOn]);

  const toggleCamera = useCallback(() => {
    if (!streamRef.current) return;

    const videoProducer = producersRef.current.get("video");
    if (videoProducer) {
      videoProducer.pause();
      streamRef.current
        .getVideoTracks()
        .forEach((track) => (track.enabled = !mediaState.isCameraOn));
      setMediaState((prev) => ({ ...prev, isCameraOn: !prev.isCameraOn }));

      socketRef.current?.emit("producer-pause", {
        producerId: videoProducer.id,
      });
    }
  }, [mediaState.isCameraOn]);

  // AI feature functions
  const requestTranscription = useCallback(
    async (audioData: Float32Array): Promise<TranscriptionResult | null> => {
      try {
        return new Promise((resolve) => {
          socketRef.current?.emit(
            "transcription-request",
            { audio: audioData },
            (response: any) => {
              if (response.error) {
                console.error("Transcription error:", response.error);
                resolve(null);
              } else {
                resolve({
                  text: response.text,
                  confidence: response.confidence,
                  language: response.language,
                  timestamp: Date.now(),
                });
              }
            }
          );
        });
      } catch (error) {
        console.error("Transcription error:", error);
        return null;
      }
    },
    []
  );

  const requestTranslation = useCallback(
    async (text: string, targetLanguage: string) => {
      socketRef.current?.emit(
        "translation-request",
        { text, targetLanguage },
        (response: any) => {
          if (response.error) {
            console.error("Translation error:", response.error);
          }
        }
      );
    },
    []
  );

  // Cleanup function
  const disconnect = useCallback(() => {
    // Stop all producers
    producersRef.current.forEach((producer) => producer.close());
    producersRef.current.clear();

    // Stop all consumers
    consumersRef.current.forEach((consumer) => consumer.close());
    consumersRef.current.clear();

    // Close transports
    producerTransportRef.current?.close();
    consumerTransportRef.current?.close();

    // Stop local stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Disconnect socket
    socketRef.current?.disconnect();
    socketRef.current = null;

    setIsConnected(false);
    setError(null);
    setParticipants([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    error,
    participants,
    mediaState,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
    requestTranscription,
    requestTranslation,
  };
}
