import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import type { QuasiPeerConfig } from "../types";

dotenvConfig();

const configSchema = z.object({
  PORT: z.string().transform(Number),
  HOST: z.string(),
  MAX_PARTICIPANTS: z.string().transform(Number),
  REDIS_URL: z.string(),

  // Media configuration
  MAX_BITRATE: z.string().transform(Number),
  MIN_BITRATE: z.string().transform(Number),
  INITIAL_BITRATE: z.string().transform(Number),
  ADAPTIVE_BITRATE_ENABLED: z
    .string()
    .transform((val: string) => val === "true"),
  VIDEO_CODECS: z.string().transform((val: string) => val.split(",")),
  AUDIO_CODECS: z.string().transform((val: string) => val.split(",")),

  // AI configuration
  TRANSCRIPTION_ENABLED: z.string().transform((val: string) => val === "true"),
  TRANSLATION_ENABLED: z.string().transform((val: string) => val === "true"),
  SUMMARIZATION_ENABLED: z.string().transform((val: string) => val === "true"),
  SUPPORTED_LANGUAGES: z.string().transform((val: string) => val.split(",")),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_CLOUD_KEY: z.string().optional(),

  // Security configuration
  JWT_SECRET: z.string(),
  E2E_ENABLED: z.string().transform((val: string) => val === "true"),
  ENCRYPTION_KEY: z.string().optional(),
});

console.log("TESTING CONFIG:", configSchema.parse(process.env));

export function loadConfig(): QuasiPeerConfig {
  const env = configSchema.parse(process.env);

  return {
    port: env.PORT,
    host: env.HOST,
    maxParticipants: env.MAX_PARTICIPANTS,
    redisUrl: env.REDIS_URL,

    mediaConfig: {
      maxBitrate: env.MAX_BITRATE,
      minBitrate: env.MIN_BITRATE,
      initialBitrate: env.INITIAL_BITRATE,
      adaptiveBitrateEnabled: env.ADAPTIVE_BITRATE_ENABLED,
      videoCodecs: env.VIDEO_CODECS,
      audioCodecs: env.AUDIO_CODECS,
    },

    aiConfig: {
      transcriptionEnabled: env.TRANSCRIPTION_ENABLED,
      translationEnabled: env.TRANSLATION_ENABLED,
      summarizationEnabled: env.SUMMARIZATION_ENABLED,
      supportedLanguages: env.SUPPORTED_LANGUAGES,
      openAIKey: env.OPENAI_API_KEY,
      googleCloudKey: env.GOOGLE_CLOUD_KEY,
    },

    security: {
      jwtSecret: env.JWT_SECRET,
      e2eEnabled: env.E2E_ENABLED,
      encryptionKey: env.ENCRYPTION_KEY,
    },
  };
}

export const config = loadConfig();
