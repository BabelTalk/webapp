import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";
import type { TranscriptionResult } from "@/types/quasiPeer";

interface TranscriptionPanelProps {
  transcriptions: TranscriptionResult[];
  onTranscriptionReceived?: (
    callback: (transcription: TranscriptionResult) => void
  ) => void;
  isTranscribing?: boolean;
  onToggleTranscription?: () => void;
  onRequestTranslation?: (text: string, targetLanguage: string) => Promise<any>;
  supportedLanguages?: string[];
}

export const TranscriptionPanel: React.FC<TranscriptionPanelProps> = ({
  transcriptions = [],
  onTranscriptionReceived,
  isTranscribing,
  onToggleTranscription,
  onRequestTranslation,
  supportedLanguages,
}) => {
  const [localTranscriptions, setLocalTranscriptions] =
    useState<TranscriptionResult[]>(transcriptions);

  useEffect(() => {
    if (onTranscriptionReceived) {
      const handleNewTranscription = (transcription: TranscriptionResult) => {
        setLocalTranscriptions((prev) => [...prev, transcription]);
      };
      onTranscriptionReceived(handleNewTranscription);
    }
  }, [onTranscriptionReceived]);

  return (
    <div className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Transcriptions</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTranscription}
          className={isTranscribing ? "text-red-500" : ""}
        >
          {isTranscribing ? <Mic /> : <MicOff />}
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[calc(100vh-8rem)]">
          <div className="space-y-4">
            {transcriptions?.map((transcription, index) => (
              <div key={index} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  {new Date(transcription.timestamp).toLocaleTimeString()}
                </div>
                <div className="text-sm">{transcription.text}</div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </div>
  );
};
