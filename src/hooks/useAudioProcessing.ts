import { useState, useCallback, useRef, useEffect } from "react";
import type { TranscriptionResult } from "@/types/quasiPeer";
import { useQuasiPeer } from "./useQuasiPeer";

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
          type: 'buffer-ready',
          buffer: this._buffer.slice()
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const workletInitializedRef = useRef(false);

  // Initialize QuasiPeer connection
  const { isConnected, error, requestTranscription } = useQuasiPeer({
    meetingId,
    userName,
    preferredLanguage,
    onTranscriptionResult,
    onParticipantJoined: (participant) => {
      onSpeakerIdentified?.(participant.id, participant.id);
    },
  });

  // Initialize AudioWorklet
  const initializeAudioWorklet = useCallback(async () => {
    if (!audioContext || workletInitializedRef.current) return;

    try {
      // Create a Blob containing the worklet code
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);

      // Load the audio worklet module
      await audioContext.audioWorklet.addModule(workletUrl);
      workletInitializedRef.current = true;

      // Clean up the URL
      URL.revokeObjectURL(workletUrl);
    } catch (error) {
      console.error("Failed to initialize AudioWorklet:", error);
      throw error;
    }
  }, [audioContext]);

  const startProcessing = useCallback(
    async (stream: MediaStream) => {
      if (!stream || !isConnected) return;

      try {
        // Create AudioContext with optimal settings
        const ctx =
          audioContext ||
          new AudioContext({
            latencyHint: "interactive",
            sampleRate: 48000,
          });
        setAudioContext(ctx);

        // Initialize AudioWorklet if needed
        if (!workletInitializedRef.current) {
          await initializeAudioWorklet();
        }

        // Create and configure nodes
        const source = ctx.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(ctx, "audio-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: {
            bufferSize: 4096,
          },
        });

        // Handle audio buffer messages from worklet
        workletNode.port.onmessage = async (event) => {
          if (!isProcessing) return;

          if (event.data.type === "buffer-ready") {
            try {
              const transcriptionResult = await requestTranscription(
                event.data.buffer
              );
              if (transcriptionResult) {
                onTranscriptionResult?.(transcriptionResult);
              }
            } catch (error) {
              console.error("Error processing audio:", error);
            }
          }
        };

        // Connect the audio graph
        source.connect(workletNode);
        workletNode.connect(ctx.destination);

        // Store references
        workletNodeRef.current = workletNode;

        const cleanup = () => {
          workletNode.port.onmessage = null;
          workletNode.disconnect();
          source.disconnect();
          workletNodeRef.current = null;
        };

        cleanupRef.current = cleanup;
        setIsProcessing(true);
      } catch (error) {
        console.error("Failed to initialize audio processing:", error);
        setIsProcessing(false);
      }
    },
    [
      audioContext,
      isProcessing,
      isConnected,
      requestTranscription,
      onTranscriptionResult,
      initializeAudioWorklet,
    ]
  );

  const stopProcessing = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (audioContext?.state !== "closed") {
      audioContext?.close();
    }

    setAudioContext(null);
    setIsProcessing(false);
    workletInitializedRef.current = false;
  }, [audioContext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopProcessing();
    };
  }, [stopProcessing]);

  return {
    isProcessing,
    startProcessing,
    stopProcessing,
    error,
  };
}
