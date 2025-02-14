import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TranslationResult } from "@/types/quasiPeer";

interface TranslationPanelProps {
  supportedLanguages: string[];
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
}

export function TranslationPanel({
  supportedLanguages,
  selectedLanguage,
  onLanguageChange,
}: TranslationPanelProps) {
  const [translations, setTranslations] = useState<TranslationResult[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new translations arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [translations]);

  const addTranslation = (result: TranslationResult) => {
    setTranslations((prev) => [...prev, result]);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Live Translation</CardTitle>
        <Select value={selectedLanguage} onValueChange={onLanguageChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            {supportedLanguages.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <ScrollArea
          className="h-[300px] w-full rounded-md border p-4"
          ref={scrollRef}
        >
          {translations.map((translation, index) => (
            <div
              key={`${translation.participantId}-${translation.timestamp}`}
              className="mb-4 last:mb-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  {new Date(translation.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-xs text-muted-foreground">
                  {translation.originalLanguage} → {translation.targetLanguage}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {translation.text}
              </p>
              <p className="mt-1 text-sm">{translation.translatedText}</p>
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
