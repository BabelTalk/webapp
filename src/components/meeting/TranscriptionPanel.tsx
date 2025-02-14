import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";
import type { TranscriptionResult } from "@/types/quasiPeer";

interface TranscriptionPanelProps {
  isTranscribing: boolean;
  onToggleTranscription: () => void;
  onRequestTranslation?: (text: string, targetLanguage: string) => void;
  supportedLanguages?: string[];
}

export function TranscriptionPanel({
  isTranscribing,
  onToggleTranscription,
  onRequestTranslation,
  supportedLanguages = [],
}: TranscriptionPanelProps) {
  const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>(
    []
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new transcriptions arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions]);

  const addTranscription = (result: TranscriptionResult) => {
    setTranscriptions((prev) => [...prev, result]);
  };

  const requestTranslation = (text: string, targetLanguage: string) => {
    onRequestTranslation?.(text, targetLanguage);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          Live Transcription
        </CardTitle>
        <Button
          variant={isTranscribing ? "default" : "secondary"}
          size="sm"
          onClick={onToggleTranscription}
        >
          {isTranscribing ? (
            <Mic className="h-4 w-4" />
          ) : (
            <MicOff className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea
          className="h-[300px] w-full rounded-md border p-4"
          ref={scrollRef}
        >
          {transcriptions.map((transcription, index) => (
            <div
              key={`${transcription.participantId}-${transcription.timestamp}`}
              className="mb-4 last:mb-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  {new Date(transcription.timestamp).toLocaleTimeString()}
                </span>
                {supportedLanguages.length > 0 && (
                  <div className="flex gap-2">
                    {supportedLanguages.map((lang) => (
                      <Button
                        key={lang}
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          requestTranslation(transcription.text, lang)
                        }
                      >
                        {lang}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1 text-sm">{transcription.text}</p>
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
