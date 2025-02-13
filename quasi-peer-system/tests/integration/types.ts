export interface TransportParameters {
  id: string;
  iceParameters: any;
  iceCandidates: any[];
  dtlsParameters: any;
  routerRtpCapabilities?: any;
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language: string;
}

export interface TranslationResult {
  originalLanguage: string;
  targetLanguage: string;
  translatedText: string;
}
