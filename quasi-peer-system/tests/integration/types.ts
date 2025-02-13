import { types as mediasoupTypes } from "mediasoup";

export interface TransportParameters {
  id: string;
  iceParameters: mediasoupTypes.IceParameters;
  iceCandidates: mediasoupTypes.IceCandidate[];
  dtlsParameters: mediasoupTypes.DtlsParameters;
  routerRtpCapabilities?: mediasoupTypes.RtpCapabilities;
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language: string;
  timestamp: number;
  participantId: string;
}

export interface TranslationResult extends TranscriptionResult {
  translatedText: string;
  originalLanguage: string;
  targetLanguage: string;
}
