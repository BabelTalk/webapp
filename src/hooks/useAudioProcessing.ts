import { useState, useCallback, useRef, useEffect } from "react";
import type { TranscriptionResult } from "@/types/quasiPeer";
import { useQuasiPeer } from "./useQuasiPeer";
import { Socket } from "socket.io-client";
import { io } from "socket.io-client";

interface UseAudioProcessingOptions {
  onTranscriptionResult?: (result: TranscriptionResult) => void;
  onSpeakerIdentified?: (speakerId: string, speakerName: string) => void;
  meetingId: string;
  userName: string;
  preferredLanguage: string;
}

// Audio processing worklet code
const workletCode = `
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 4096;
    this._buffer = new Float32Array(this._bufferSize);
    this._bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const channel = input[0];

    if (!channel) return true;

    // Fill the buffer
    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._bufferIndex] = channel[i];
      this._bufferIndex++;

      // When buffer is full, send it for processing
      if (this._bufferIndex === this._bufferSize) {
        this.port.postMessage({
          type: 'audio-data',
          audioData: Array.from(this._buffer)
        });
        this._bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
`;

export function useAudioProcessing({
  onTranscriptionResult,
  onSpeakerIdentified,
  meetingId,
  userName,
  preferredLanguage,
}: UseAudioProcessingOptions) {
  const [workletNode, setWorkletNode] = useState<AudioWorkletNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isProcessingRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const isClosingRef = useRef(false);

  useEffect(() => {
    if (!meetingId) return;

    let isMounted = true;

    // Connect to the transcription namespace using the same base URL
    const baseUrl =
      process.env.NEXT_PUBLIC_QUASI_PEER_URL || "https://localhost:3004";
    socketRef.current = io(`${baseUrl}/transcription`, {
      transports: ["websocket"],
      path: "/socket.io",
    });

    socketRef.current.on("connect", () => {
      console.log("[DEBUG][AudioProcessing] Transcription socket connected");
      socketRef.current?.emit("join-transcription-room", meetingId);
    });

    socketRef.current.on("transcription-result", (result) => {
      console.log("[DEBUG][AudioProcessing] Received transcription:", result);
      onTranscriptionResult?.(result);
    });

    socketRef.current.on("speaker-identified", (data) => {
      console.log("[DEBUG][AudioProcessing] Speaker identified:", data);
      onSpeakerIdentified?.(data.speakerId, data.speakerName);
    });

    socketRef.current.on("disconnect", () => {
      console.log("[DEBUG][AudioProcessing] Transcription socket disconnected");
    });

    return () => {
      if (!isMounted) {
        console.log(
          "[DEBUG][AudioProcessing] Component unmounting, cleaning up"
        );
        if (isProcessingRef.current) {
          stopProcessing();
        }
        socketRef.current?.disconnect();
      }
      isMounted = false;
    };
  }, [meetingId]);

  // Initialize AudioContext and AudioWorklet
  const initializeAudioContext = useCallback(async () => {
    try {
      // If we already have a context, return it
      if (audioContextRef.current) {
        console.log("[DEBUG][AudioProcessing] Reusing existing AudioContext");
        return audioContextRef.current;
      }

      // If we don't have a context and we're not closing, create a new one
      if (!isClosingRef.current) {
        console.log("[DEBUG][AudioProcessing] Creating new AudioContext");
        const newContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)();

        if (!newContext) {
          console.error(
            "[DEBUG][AudioProcessing] Failed to create AudioContext"
          );
          return null;
        }

        console.log(
          "[DEBUG][AudioProcessing] AudioContext created, state:",
          newContext.state
        );

        try {
          console.log("[DEBUG][AudioProcessing] Loading audio worklet");
          const workletUrl = new URL(
            "/audio-processor.js",
            window.location.origin
          );
          await newContext.audioWorklet.addModule(workletUrl.toString());
          console.log(
            "[DEBUG][AudioProcessing] Audio worklet loaded successfully"
          );
        } catch (workletError) {
          console.error(
            "[DEBUG][AudioProcessing] Worklet load error:",
            workletError
          );
          newContext.close();
          throw workletError;
        }

        audioContextRef.current = newContext;
        return newContext;
      }

      console.error(
        "[DEBUG][AudioProcessing] Cannot create context while closing"
      );
      return null;
    } catch (error) {
      console.error(
        "[DEBUG][AudioProcessing] AudioContext initialization error:",
        error
      );
      throw error;
    }
  }, []);

  const startProcessing = useCallback(
    async (stream: MediaStream) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      console.log("[DEBUG][AudioProcessing] Starting with stream:", {
        streamActive: stream.active,
        audioTracks: stream.getAudioTracks().map((track) => ({
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          id: track.id,
        })),
      });

      try {
        if (!socketRef.current?.connected) {
          console.log(
            "[DEBUG][AudioProcessing] Waiting for socket connection..."
          );
          await new Promise<void>((resolve) => {
            socketRef.current?.once("connect", () => resolve());
          });
        }

        const context = await initializeAudioContext();
        if (!context) {
          throw new Error("Failed to initialize audio context");
        }

        // Create AudioWorkletNode
        const processorNode = new AudioWorkletNode(context, "audio-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          processorOptions: {
            meetingId,
            userId: socketRef.current?.id,
            userName,
            language: preferredLanguage,
          },
        });

        console.log("[DEBUG][AudioProcessing] Audio worklet node created");

        // Set up message handling from the worklet
        processorNode.port.onmessage = (event) => {
          if (
            event.data.type === "audio-data" &&
            socketRef.current?.connected
          ) {
            console.log(
              "[DEBUG][AudioProcessing] Sending audio data, size:",
              event.data.audioData.length
            );
            socketRef.current.emit("audio-data", {
              meetingId,
              userId: socketRef.current.id,
              userName,
              audioData: event.data.audioData,
              timestamp: Date.now(),
              language: preferredLanguage,
            });
          }
        };

        // Connect the stream
        const source = context!.createMediaStreamSource(stream);
        source.connect(processorNode);
        processorNode.connect(context!.destination);

        setWorkletNode(processorNode);

        console.log(
          "[DEBUG][AudioProcessing] Processing started, audio pipeline connected"
        );
      } catch (error) {
        console.error(
          "[DEBUG][AudioProcessing] Error starting audio processing:",
          error
        );
        isProcessingRef.current = false;
      }
    },
    [meetingId, userName, preferredLanguage, initializeAudioContext]
  );

  const stopProcessing = useCallback(() => {
    if (!isProcessingRef.current) return;

    console.log("[DEBUG][AudioProcessing] Stopping audio processing");

    if (workletNode) {
      workletNode.disconnect();
      setWorkletNode(null);
    }

    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
      audioContextRef.current = null;
    }

    isProcessingRef.current = false;
  }, [workletNode]);

  useEffect(() => {
    let isMounted = true;

    return () => {
      if (isMounted) {
        isClosingRef.current = false;
      } else {
        isClosingRef.current = true;
      }
      isMounted = false;
    };
  }, []);

  return {
    startProcessing,
    stopProcessing,
    isProcessing: isProcessingRef.current,
  };
}
