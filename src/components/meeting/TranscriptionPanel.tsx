import React, {
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mic, MicOff, Languages } from "lucide-react";
import { TranscriptionResult } from "@/types/quasiPeer";
import { setupMockTranscription } from "@/utils/mockTranscription";

interface TranscriptionPanelProps {
  isTranscribing: boolean;
  onToggleTranscription: () => void;
  onRequestTranslation?: (text: string, targetLanguage: string) => Promise<any>;
  supportedLanguages?: string[];
}

export const TranscriptionPanel = forwardRef<any, TranscriptionPanelProps>(
  (
    {
      isTranscribing,
      onToggleTranscription,
      onRequestTranslation,
      supportedLanguages = ["en", "es", "fr", "de"],
    },
    ref
  ) => {
    const [transcripts, setTranscripts] = useState<TranscriptionResult[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState("en");
    const [useMockData, setUseMockData] = useState(false);

    useImperativeHandle(ref, () => ({
      addTranscription: (result: TranscriptionResult) => {
        console.log("Adding transcription to panel:", result);
        setTranscripts((prev) => [...prev, result]);
      },
      getTranscripts: () => transcripts,
    }));

    // Setup mock transcription for testing if needed
    useEffect(() => {
      if (useMockData && isTranscribing) {
        console.log("Setting up mock transcription data");
        const cleanup = setupMockTranscription((result) => {
          setTranscripts((prev) => [...prev, result]);
        });
        return cleanup;
      }
    }, [useMockData, isTranscribing]);

    return (
      <div className="flex flex-col h-full">
        <div className="border-b p-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Button
              variant={isTranscribing ? "default" : "outline"}
              size="sm"
              onClick={onToggleTranscription}
              className={isTranscribing ? "bg-primary" : ""}
            >
              {isTranscribing ? (
                <>
                  <Mic className="h-4 w-4 mr-1" /> Transcribing...
                </>
              ) : (
                <>
                  <MicOff className="h-4 w-4 mr-1" /> Start Transcription
                </>
              )}
            </Button>
            {!process.env.NEXT_PUBLIC_QUASI_PEER_URL && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUseMockData(!useMockData)}
              >
                {useMockData ? "Using Mock Data" : "Use Mock Data"}
              </Button>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Languages className="h-4 w-4" />
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="text-sm border rounded p-1"
            >
              {supportedLanguages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {transcripts.length === 0 ? (
            <div className="text-center text-gray-400 italic">
              {isTranscribing
                ? "Waiting for speech to transcribe..."
                : "Start transcription to see content here"}
            </div>
          ) : (
            <div className="space-y-3">
              {transcripts.map((transcript, index) => (
                <Card key={index} className="p-3">
                  <p className="text-sm">{transcript.text}</p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs text-gray-500">
                      {new Date(transcript.timestamp).toLocaleTimeString()}
                    </span>
                    {onRequestTranslation && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (
                            selectedLanguage !== transcript.language &&
                            onRequestTranslation
                          ) {
                            const result = await onRequestTranslation(
                              transcript.text,
                              selectedLanguage
                            );
                            console.log("Translation result:", result);
                          }
                        }}
                      >
                        Translate
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

TranscriptionPanel.displayName = "TranscriptionPanel";
