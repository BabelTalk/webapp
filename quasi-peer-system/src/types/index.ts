import type { types as mediasoupTypes } from "mediasoup";

export interface QuasiPeerConfig {
  port: number;
  host: string;
  maxParticipants: number;
  redisUrl: string;
  mediaConfig: MediaConfig;
  aiConfig: AIConfig;
  security: SecurityConfig;
}

export interface MediaConfig {
  maxBitrate: number;
  minBitrate: number;
  initialBitrate: number;
  adaptiveBitrateEnabled: boolean;
  videoCodecs: string[];
  audioCodecs: string[];
}

export interface AIConfig {
  transcriptionEnabled: boolean;
  translationEnabled: boolean;
  summarizationEnabled: boolean;
  supportedLanguages: string[];
  openAIKey?: string;
  googleCloudKey?: string;
}

export interface SecurityConfig {
  jwtSecret: string;
  e2eEnabled: boolean;
  encryptionKey?: string;
}

export interface Participant {
  id: string;
  meetingId: string;
  streams: MediaStream[];
  preferredLanguage: string;
  role: ParticipantRole;
  connectionInfo: ConnectionInfo;
  transport?: mediasoupTypes.WebRtcTransport;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

export enum ParticipantRole {
  HOST = "host",
  PARTICIPANT = "participant",
  OBSERVER = "observer",
}

export interface ConnectionInfo {
  ip: string;
  userAgent: string;
  bandwidth: number;
  latency: number;
}

export interface MediaStream {
  id: string;
  type: "audio" | "video";
  bitrate: number;
  codec: string;
  active: boolean;
  rtpParameters?: mediasoupTypes.RtpParameters;
  rtpCapabilities?: mediasoupTypes.RtpCapabilities;
}

export interface TranscriptionResult {
  participantId: string;
  text: string;
  timestamp: number;
  confidence: number;
  language: string;
}

export interface TranslationResult extends TranscriptionResult {
  originalLanguage: string;
  targetLanguage: string;
  translatedText: string;
}

export interface MeetingSummary {
  meetingId: string;
  duration: number;
  participants: string[];
  topics: string[];
  keyPoints: string[];
  actionItems: string[];
  transcriptUrl?: string;
}

export interface ServerMetrics {
  activeParticipants: number;
  cpuUsage: number;
  memoryUsage: number;
  networkBandwidth: number;
  activeTranscriptions: number;
  activeTranslations: number;
  errorRate: number;
}
