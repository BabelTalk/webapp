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
  maxReconnectionAttempts?: number;
  enableLogging?: boolean;
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
  maxReconnectionAttempts = 3,
  enableLogging = false,
}: UseQuasiPeerOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mediaState, setMediaState] = useState<MediaState>({
    isMicOn: true,
    isCameraOn: true,
    isScreenSharing: false,
  });
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectionAttempts, setReconnectionAttempts] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const producerTransportRef = useRef<any>(null);
  const consumerTransportRef = useRef<any>(null);
  const producersRef = useRef<Map<string, any>>(new Map());
  const consumersRef = useRef<Map<string, any>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  const isConnectingRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptionSocketRef = useRef<Socket | null>(null);

  // Enhanced logging function
  const log = useCallback(
    (...args: any[]) => {
      if (enableLogging) {
        console.log("[QuasiPeer]", ...args);
      }
    },
    [enableLogging]
  );

  // Handle connection errors with reconnection logic
  const handleConnectionError = useCallback(
    (error: Error) => {
      log("Connection error:", error);
      setError(error.message);
      isConnectingRef.current = false;

      if (reconnectionAttempts < maxReconnectionAttempts) {
        setIsReconnecting(true);
        setReconnectionAttempts((prev) => prev + 1);
        handleReconnect();
      } else {
        setIsReconnecting(false);
        setError(`Connection failed after ${maxReconnectionAttempts} attempts`);
      }
    },
    [maxReconnectionAttempts, reconnectionAttempts, log]
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setIsConnected(false);
    isConnectingRef.current = false;
  }, []);

  // Enhanced connect function with WSS support
  const connect = useCallback(
    async (
      stream: MediaStream,
      options?: { isMuted?: boolean; isCameraOff?: boolean }
    ): Promise<boolean> => {
      // Prevent multiple connection attempts
      if (isConnectingRef.current) {
        log("Connection attempt already in progress");
        return false;
      }

      if (socketRef.current?.connected) {
        log("Connection already established");
        return true;
      }

      try {
        // Clean up any existing connection
        cleanup();

        isConnectingRef.current = true;
        streamRef.current = stream;

        const serverUrl =
          process.env.NEXT_PUBLIC_QUASI_PEER_URL || "wss://localhost:3004";
        log("Connecting to:", serverUrl);

        // Create socket instance
        socketRef.current = io(serverUrl, {
          transports: ["websocket"],
          secure: true,
          rejectUnauthorized: false, // Important for self-signed certs
          reconnection: true,
          reconnectionAttempts: maxReconnectionAttempts,
        });

        // Add error event listener
        socketRef.current.on("error", (error: Error) => {
          log("[SOCKET-DEBUG] Socket error:", error);
        });

        // Create transcription socket connection
        transcriptionSocketRef.current = io(`${serverUrl}/transcription`, {
          transports: ["websocket"],
          secure: true,
          rejectUnauthorized: false,
        });

        transcriptionSocketRef.current.on("connect", () => {
          log("Transcription socket connected");
          // Join the transcription room when connected
          transcriptionSocketRef.current?.emit("join-transcription", {
            roomId: meetingId,
            userName,
          });
        });

        transcriptionSocketRef.current.on(
          "transcription-result",
          (data: any) => {
            log("Received transcription result:", data);
            if (onTranscriptionResult) {
              onTranscriptionResult({
                text: data.text,
                confidence: data.confidence,
                userId: data.user_id,
                roomId: data.room_id,
                isFinal: data.is_final,
                error: data.error,
                timestamp: Date.now(),
                participantId: data.user_id,
                language: "en",
              });
            }
          }
        );

        return new Promise<boolean>((resolve) => {
          // Set timeout for connection
          const connectionTimeout = setTimeout(() => {
            log("Connection timeout");
            handleConnectionError(new Error("Connection timeout"));
            resolve(false);
          }, 10000);

          // Set up event handlers
          socketRef.current!.on("connect", () => {
            log(`Connected with ID: ${socketRef.current?.id}`);
            clearTimeout(connectionTimeout);
            setIsConnected(true);
            setIsReconnecting(false);
            setReconnectionAttempts(0);
            isConnectingRef.current = false;
            setError(null);

            // Join the meeting
            socketRef.current?.emit("join-meeting", {
              meetingId,
              participantInfo: {
                userName,
                preferredLanguage,
                role: ParticipantRole.PARTICIPANT,
                connectionInfo: {
                  userAgent: navigator.userAgent,
                  bandwidth: 1000000,
                  latency: 0,
                },
                isMuted: options?.isMuted || false,
                isCameraOff: options?.isCameraOff || false,
              },
            });

            resolve(true);
          });

          socketRef.current!.on("connect_error", (error) => {
            log("Connect error:", error);
            clearTimeout(connectionTimeout);
            handleConnectionError(
              error instanceof Error ? error : new Error(String(error))
            );
            resolve(false);
          });

          socketRef.current!.on("disconnect", (reason) => {
            log("Disconnected:", reason);
            setIsConnected(false);

            // Only attempt reconnect for certain disconnect reasons
            if (
              reason === "io server disconnect" ||
              reason === "transport close"
            ) {
              handleReconnect();
            }
          });

          // Attempt connection
          socketRef.current!.connect();
        });
      } catch (error) {
        log("Failed to initialize connection:", error);
        handleConnectionError(error as Error);
        return false;
      }
    },
    [log, maxReconnectionAttempts]
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!socketRef.current?.connected && !isConnectingRef.current) {
        log("Socket disconnected - attempting reconnection");
        if (streamRef.current) {
          connect(streamRef.current);
        }
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(intervalId);
  }, [connect]);

  // Handle reconnection
  const handleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return;

    reconnectTimeoutRef.current = setTimeout(() => {
      if (streamRef.current) {
        connect(streamRef.current);
      }
      reconnectTimeoutRef.current = null;
    }, 5000); // Wait 5 seconds before reconnecting
  }, [connect]);

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

  const ensureConnection = useCallback(async () => {
    if (!socketRef.current?.connected && streamRef.current) {
      log("Socket disconnected - attempting to reconnect");
      await connect(streamRef.current);
    }
  }, [connect]);

  // Media control functions
  const toggleMic = useCallback(() => {
    if (!streamRef.current) return;

    const audioProducer = producersRef.current.get("audio");
    if (audioProducer) {
      const newMicState = !mediaState.isMicOn;

      // Update track enabled state
      streamRef.current
        .getAudioTracks()
        .forEach((track) => (track.enabled = newMicState));

      // Update producer state
      if (newMicState) {
        audioProducer.resume();
        socketRef.current?.emit("producer-resume", {
          producerId: audioProducer.id,
        });
      } else {
        audioProducer.pause();
        socketRef.current?.emit("producer-pause", {
          producerId: audioProducer.id,
        });
      }

      // Emit microphone state to transcription namespace
      transcriptionSocketRef.current?.emit("microphone-state", newMicState);

      // Update media state
      setMediaState((prev) => ({ ...prev, isMicOn: newMicState }));
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
        return new Promise<TranscriptionResult | null>((resolve, reject) => {
          if (!socketRef.current || !socketRef.current.connected) {
            console.error("Socket not connected for transcription request");
            resolve(null);
            return;
          }

          // Add timeout handling
          const timeoutId = setTimeout(() => {
            console.warn("Transcription request timed out after 5000ms");
            resolve(null);
          }, 5000); // 5 second timeout

          socketRef.current.emit(
            "transcription-request",
            { audio: audioData },
            (response: any) => {
              clearTimeout(timeoutId); // Clear timeout on response

              if (response?.error) {
                console.error("Transcription error:", response.error);
                resolve(null);
              } else if (response) {
                resolve({
                  text: response.text,
                  confidence: response.confidence,
                  language: response.language,
                  timestamp: Date.now(),
                  participantId: response.participantId || "local-user",
                  userId: response.userId || "local-user",
                  userName: response.userName || "local-user",
                  isFinal: response.isFinal || false,
                });
              } else {
                console.error("Empty response from transcription server");
                resolve(null);
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
    return cleanup;
  }, [cleanup]);

  return {
    isConnected,
    error,
    participants,
    mediaState,
    isReconnecting,
    reconnectionAttempts,
    maxReconnectionAttempts,
    socket: socketRef.current,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
    requestTranscription,
    requestTranslation,
  };
}
