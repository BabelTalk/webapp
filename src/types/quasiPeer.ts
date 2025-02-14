import { types as mediasoupTypes } from "mediasoup-client";

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
  transport?: mediasoupTypes.Transport;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

export enum ParticipantRole {
  HOST = "host",
  PARTICIPANT = "participant",
  OBSERVER = "observer",
}

export interface ConnectionInfo {
  ip?: string;
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
  text: string;
  confidence: number;
  language: string;
  timestamp: number;
  participantId?: string;
}

export interface TranslationResult extends TranscriptionResult {
  originalLanguage: string;
  targetLanguage: string;
  translatedText: string;
  sentiment?: {
    score: number;
    label: string;
  };
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
