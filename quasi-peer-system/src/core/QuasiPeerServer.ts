import { Server, Namespace, Socket } from "socket.io";
import { createServer } from "http";
import https from "https";
import Redis from "ioredis";
import * as mediasoup from "mediasoup";
import { types as mediasoupTypes } from "mediasoup";
import { config } from "../config/config";
import { register, Gauge } from "prom-client";
import type {
  Participant,
  MediaStream,
  TranscriptionResult,
  TranslationResult,
  ServerMetrics,
  MeetingSummary,
  TranscriptionResponse,
} from "../types";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import axios from "axios";
import WebSocket from "ws";
import { EventEmitter } from "events";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

interface PendingTranscriptionRequest {
  requestId: string;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
}

interface TranscriptionStream {
  stream: any;
  userId: string;
  roomId: string;
}

export class QuasiPeerServer extends EventEmitter {
  private io: Server;
  private httpsServer: https.Server;
  private redis: Redis;
  private participants: Map<string, Participant>;
  private metrics: ServerMetrics;
  private mediasoupWorker!: mediasoupTypes.Worker;
  private mediasoupRouter!: mediasoupTypes.Router;
  private transportMap = new Map<string, mediasoupTypes.WebRtcTransport>();
  private metricsInterval: NodeJS.Timeout | null = null;
  private speechRecognitionPipeline: any;
  private translationPipelines: Map<string, any> = new Map();
  private summaryPipeline: any;
  private transcriptionNamespace: Namespace;

  // Prometheus metrics
  private activeParticipantsGauge!: Gauge<string>;
  private cpuUsageGauge!: Gauge<string>;
  private memoryUsageGauge!: Gauge<string>;
  private networkBandwidthGauge!: Gauge<string>;
  private activeTranscriptionsGauge!: Gauge<string>;
  private activeTranslationsGauge!: Gauge<string>;
  private errorRateGauge!: Gauge<string>;

  // Supported language pairs with their corresponding models
  private readonly supportedTranslations = {
    "en-hi": "facebook/mbart-large-50-many-to-many-mmt",
    "hi-en": "facebook/mbart-large-50-many-to-many-mmt",
    "hi-mr": "facebook/mbart-large-50-many-to-many-mmt",
    "mr-hi": "facebook/mbart-large-50-many-to-many-mmt",
    "en-mr": "facebook/mbart-large-50-many-to-many-mmt",
    "mr-en": "facebook/mbart-large-50-many-to-many-mmt",
  };

  // Language code mapping for mBART-50
  private readonly mbartLanguageCodes: { [key: string]: string } = {
    en: "en_XX",
    hi: "hi_IN",
    mr: "mr_IN",
  };

  private readonly WHISPER_SAMPLE_RATE = 16000;
  private readonly MIN_AUDIO_LENGTH = 8000; // Reduced to 0.5 seconds (was 16000)
  private readonly MAX_AUDIO_LENGTH = 16000; // Added max length of 1 second
  private audioBuffer: Float32Array | null = null;

  private aiServiceClient: any;

  // Add new properties for WebSocket handling
  private aiWebSocket: WebSocket | null = null;
  private wsReconnectInterval: NodeJS.Timeout | null = null;
  private pendingTranscriptionRequests: Map<string, (result: any) => void> =
    new Map();

  // Add a new property to track microphone state
  private activeMicrophones: Set<string> = new Set();

  private transcriptionClient: any;
  private activeStreams: Map<string, TranscriptionStream> = new Map();

  constructor() {
    super();
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const httpsOptions = {
      key: fs.readFileSync(
        path.join(__dirname, "..", "..", "certificates", "localhost.key")
      ),
      cert: fs.readFileSync(
        path.join(__dirname, "..", "..", "certificates", "localhost.crt")
      ),
    };

    this.httpsServer = https.createServer(httpsOptions);
    this.io = new Server(this.httpsServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
      transports: ["websocket"],
      allowEIO3: true,
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.redis = new Redis(config.redisUrl);
    this.participants = new Map();
    this.metrics = this.initializeMetrics();
    this.setupPrometheusMetrics();
    this.setupMediasoup();
    this.startMetricsCollection();

    // Initialize transcription namespace
    this.transcriptionNamespace = this.io.of("/transcription");
    this.initializeTranscriptionNamespace();

    this.setupGRPCClient();
  }

  private setupPrometheusMetrics(): void {
    // Clear default registry to avoid duplicate metrics
    register.clear();

    this.activeParticipantsGauge = new Gauge({
      name: "quasi_peer_active_participants",
      help: "Number of active participants",
      registers: [register],
    });

    this.cpuUsageGauge = new Gauge({
      name: "quasi_peer_cpu_usage",
      help: "CPU usage percentage",
      registers: [register],
    });

    this.memoryUsageGauge = new Gauge({
      name: "quasi_peer_memory_usage",
      help: "Memory usage in bytes",
      registers: [register],
    });

    this.networkBandwidthGauge = new Gauge({
      name: "quasi_peer_network_bandwidth",
      help: "Network bandwidth usage in bytes/sec",
      registers: [register],
    });

    this.activeTranscriptionsGauge = new Gauge({
      name: "quasi_peer_active_transcriptions",
      help: "Number of active transcriptions",
      registers: [register],
    });

    this.activeTranslationsGauge = new Gauge({
      name: "quasi_peer_active_translations",
      help: "Number of active translations",
      registers: [register],
    });

    this.errorRateGauge = new Gauge({
      name: "quasi_peer_error_rate",
      help: "Error rate per minute",
      registers: [register],
    });
  }

  private async setupMediasoup(): Promise<void> {
    // Create a mediasoup worker
    this.mediasoupWorker = await mediasoup.createWorker({
      logLevel: "warn",
      logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    });

    // Create a mediasoup router
    this.mediasoupRouter = await this.mediasoupWorker.createRouter({
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/VP9",
          clockRate: 90000,
          parameters: {
            "profile-id": 2,
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "4d0032",
            "level-asymmetry-allowed": 1,
            "x-google-start-bitrate": 1000,
          },
        },
      ],
    });

    // Handle worker shutdown
    this.mediasoupWorker.on("died", () => {
      console.error(
        "mediasoup worker died, exiting in 2 seconds... [pid:%d]",
        this.mediasoupWorker.pid
      );
      setTimeout(() => process.exit(1), 2000);
    });
  }

  private initializeMetrics(): ServerMetrics {
    return {
      activeParticipants: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      networkBandwidth: 0,
      activeTranscriptions: 0,
      activeTranslations: 0,
      errorRate: 0,
    };
  }

  private async handleJoinMeeting(
    socket: any,
    data: { meetingId: string; participantInfo: Participant }
  ): Promise<void> {
    try {
      if (this.participants.size >= config.maxParticipants) {
        socket.emit("error", { message: "Meeting is at maximum capacity" });
        return;
      }

      const participant: Participant = {
        ...data.participantInfo,
        id: socket.id,
        meetingId: data.meetingId,
        streams: [],
      };

      // Create WebRTC transport for participant
      const transport = await this.createWebRtcTransport(participant);

      this.participants.set(socket.id, participant);
      socket.join(data.meetingId);

      // Send transport parameters to client
      socket.emit("transport-parameters", {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });

      // Notify other participants
      socket.to(data.meetingId).emit("participant-joined", participant);

      // Update metrics
      this.metrics.activeParticipants = this.participants.size;
      this.activeParticipantsGauge.set(this.metrics.activeParticipants);

      // Store participant info in Redis for fault tolerance
      await this.redis.hset(
        `meeting:${data.meetingId}`,
        socket.id,
        JSON.stringify(participant)
      );
    } catch (error) {
      console.error("Error in handleJoinMeeting:", error);
      socket.emit("error", { message: "Failed to join meeting" });
    }
  }

  private async createWebRtcTransport(
    participant: Participant
  ): Promise<mediasoupTypes.WebRtcTransport> {
    const transport = await this.mediasoupRouter.createWebRtcTransport({
      listenIps: [
        {
          ip: config.host === "localhost" ? "127.0.0.1" : config.host,
          announcedIp: undefined,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: config.mediaConfig.initialBitrate,
    });

    transport.on("dtlsstatechange", (dtlsState: mediasoupTypes.DtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
        this.transportMap.delete(transport.id);
      }
    });

    this.transportMap.set(transport.id, transport);
    return transport;
  }

  private async handleConnectTransport(
    socket: any,
    data: {
      transportId: string;
      dtlsParameters: mediasoupTypes.DtlsParameters;
    }
  ): Promise<void> {
    const transport = this.transportMap.get(data.transportId);
    if (!transport) throw new Error("Transport not found");
    await transport.connect({ dtlsParameters: data.dtlsParameters });
  }

  private async handleProduce(
    socket: any,
    data: {
      transportId: string;
      kind: mediasoupTypes.MediaKind;
      rtpParameters: mediasoupTypes.RtpParameters;
    }
  ): Promise<void> {
    const transport = this.transportMap.get(data.transportId);
    if (!transport) throw new Error("Transport not found");
    const producer = await transport.produce({
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });

    producer.on("transportclose", () => {
      producer.close();
    });

    socket.emit("producer-created", { id: producer.id });
  }

  private async handleConsume(
    socket: any,
    data: {
      transportId: string;
      producerId: string;
      rtpCapabilities: mediasoupTypes.RtpCapabilities;
    }
  ): Promise<void> {
    const transport = this.transportMap.get(data.transportId);
    if (!transport) throw new Error("Transport not found");
    const consumer = await transport.consume({
      producerId: data.producerId,
      rtpCapabilities: data.rtpCapabilities,
    });

    consumer.on("transportclose", () => {
      consumer.close();
    });

    socket.emit("consumer-created", {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }

  private async handleLeaveMeeting(socket: any): Promise<void> {
    try {
      const participant = this.participants.get(socket.id);
      if (participant) {
        this.participants.delete(socket.id);
        socket.to(participant.meetingId).emit("participant-left", participant);

        // Generate meeting summary when last participant leaves
        const meetingParticipants = Array.from(
          this.participants.values()
        ).filter((p) => p.meetingId === participant.meetingId);

        if (meetingParticipants.length === 0) {
          const summary = await this.generateMeetingSummary(
            participant.meetingId
          );
          // Emit summary to all participants who were in the meeting
          this.io.to(participant.meetingId).emit("meeting-summary", summary);
        }

        // Update metrics
        this.metrics.activeParticipants = this.participants.size;
        this.activeParticipantsGauge.set(this.metrics.activeParticipants);

        // Remove from Redis
        await this.redis.hdel(`meeting:${participant.meetingId}`, socket.id);
      }
    } catch (error) {
      console.error("Error in handleLeaveMeeting:", error);
      this.metrics.errorRate++;
      this.errorRateGauge.inc();
    }
  }

  private handleDisconnect(socket: any): void {
    this.handleLeaveMeeting(socket);
  }

  private async handleTranscriptionRequest(
    socket: any,
    audioData: Buffer
  ): Promise<void> {
    try {
      const participant = this.participants.get(socket.id);
      if (!participant) {
        socket.emit("error", { message: "Participant not found" });
        return;
      }

      this.metrics.activeTranscriptions++;
      this.activeTranscriptionsGauge.inc();

      // Add near audio data reception
      console.log(
        "[DEBUG][Server] Received audio data chunk, size:",
        audioData.length
      );
      console.log("[DEBUG][Server] Processing audio through pipeline");

      const result = await this.processTranscription(audioData);
      result.participantId = socket.id;

      // Store transcription for meeting summary
      await this.storeTranscription(participant.meetingId, result);

      socket.emit("transcription-result", result);

      this.metrics.activeTranscriptions--;
      this.activeTranscriptionsGauge.dec();
    } catch (error) {
      console.error("Error in handleTranscriptionRequest:", error);
      this.metrics.errorRate++;
      this.errorRateGauge.inc();
      this.metrics.activeTranscriptions--;
      this.activeTranscriptionsGauge.dec();
      socket.emit("error", { message: "Transcription failed" });
    }
  }

  private async handleTranslationRequest(
    socket: any,
    data: { text: string; targetLanguage: string }
  ): Promise<void> {
    try {
      const participant = this.participants.get(socket.id);
      if (!participant) {
        socket.emit("error", { message: "Participant not found" });
        return;
      }

      this.metrics.activeTranslations++;

      const result = await this.processTranslation(data);
      result.participantId = socket.id;

      socket.emit("translation-result", result);
      this.metrics.activeTranslations--;
    } catch (error) {
      console.error("Error in handleTranslationRequest:", error);
      this.metrics.errorRate++;
      this.metrics.activeTranslations--;
      socket.emit("error", { message: "Translation failed" });
    }
  }

  private async processTranscription(
    audioData: Buffer
  ): Promise<TranscriptionResult> {
    try {
      const response = await this.aiServiceClient.post("/transcribe", {
        audio: audioData.toString("base64"),
      });
      return response.data;
    } catch (error) {
      console.error("Error in processTranscription:", error);
      throw error;
    }
  }

  private async processTranslation(data: {
    text: string;
    targetLanguage: string;
  }): Promise<TranslationResult> {
    try {
      const response = await this.aiServiceClient.post("/translate", {
        text: data.text,
        target_lang: data.targetLanguage,
      });

      return {
        text: data.text,
        translatedText: response.data.translated_text,
        confidence: response.data.confidence,
        language: "en",
        originalLanguage: "en",
        targetLanguage: data.targetLanguage,
        timestamp: Date.now(),
        participantId: "test-participant",
      };
    } catch (error) {
      console.error("Error in processTranslation:", error);
      throw error;
    }
  }

  private async storeTranscription(
    meetingId: string,
    transcription: TranscriptionResult
  ): Promise<void> {
    try {
      // Store in Redis with TTL for temporary storage
      const key = `transcription:${meetingId}:${Date.now()}`;
      await this.redis.setex(
        key,
        86400, // 24 hours TTL
        JSON.stringify(transcription)
      );

      // Add to the meeting's transcription list
      await this.redis.rpush(
        `meeting:${meetingId}:transcriptions`,
        JSON.stringify(transcription)
      );
    } catch (error) {
      console.error("Error storing transcription:", error);
      throw error;
    }
  }

  private async generateMeetingSummary(
    meetingId: string
  ): Promise<MeetingSummary> {
    try {
      const transcriptions = await this.redis.lrange(
        `meeting:${meetingId}:transcriptions`,
        0,
        -1
      );

      if (transcriptions.length === 0) {
        throw new Error("No transcriptions found for meeting");
      }

      const parsedTranscriptions = transcriptions.map((t) => JSON.parse(t));
      const fullText = parsedTranscriptions.map((t) => t.text).join(" ");
      const firstTranscriptionTime = parsedTranscriptions[0].timestamp;

      const response = await this.aiServiceClient.post("/summarize", {
        text: fullText,
      });

      const meetingSummary: MeetingSummary = {
        meetingId,
        duration: Date.now() - firstTranscriptionTime,
        participants: Array.from(
          new Set(parsedTranscriptions.map((t) => t.participantId))
        ),
        topics: [],
        keyPoints: [response.data.summary],
        actionItems: [],
      };

      await this.redis.setex(
        `meeting:${meetingId}:summary`,
        86400,
        JSON.stringify(meetingSummary)
      );

      return meetingSummary;
    } catch (error) {
      console.error("Error generating meeting summary:", error);
      throw error;
    }
  }

  private getSupportedLanguages(): string[] {
    const languages = new Set<string>();
    for (const langPair of Object.keys(this.supportedTranslations)) {
      const [src, tgt] = langPair.split("-");
      languages.add(src);
      languages.add(tgt);
    }
    return Array.from(languages);
  }

  private updateBandwidthMetrics(stream: MediaStream): void {
    // Update network bandwidth metrics based on stream bitrate
    this.metrics.networkBandwidth += stream.bitrate;
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      // Collect and update system metrics
      this.updateSystemMetrics();

      // Publish metrics to Redis for monitoring
      this.redis.hset("metrics", this.metrics);
    }, 5000); // Update every 5 seconds
  }

  private updateSystemMetrics(): void {
    const usage = process.cpuUsage();
    const memUsage = process.memoryUsage();

    // Update Prometheus metrics
    this.cpuUsageGauge.set(((usage.user + usage.system) / 1000000) * 100);
    this.memoryUsageGauge.set(memUsage.heapUsed);
    this.activeParticipantsGauge.set(this.metrics.activeParticipants);
    this.networkBandwidthGauge.set(this.metrics.networkBandwidth);
    this.activeTranscriptionsGauge.set(this.metrics.activeTranscriptions);
    this.activeTranslationsGauge.set(this.metrics.activeTranslations);
    this.errorRateGauge.set(this.metrics.errorRate);

    // Update internal metrics
    this.metrics.cpuUsage = ((usage.user + usage.system) / 1000000) * 100;
    this.metrics.memoryUsage = memUsage.heapUsed;
  }

  public async start(): Promise<void> {
    try {
      await this.redis.ping();
      await this.setupMediasoup();
      this.httpsServer.listen(config.port, () => {
        console.log(
          `QuasiPeer server listening on port ${config.port} (HTTPS/WSS)`
        );
      });
    } catch (error) {
      console.error("Failed to start server:", error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      // Clean up WebSocket connection
      if (this.aiWebSocket) {
        this.aiWebSocket.removeAllListeners();
        this.aiWebSocket.terminate();
        this.aiWebSocket = null;
      }

      // Clear reconnection interval
      if (this.wsReconnectInterval) {
        clearInterval(this.wsReconnectInterval);
        this.wsReconnectInterval = null;
      }

      // Clear all pending requests
      this.pendingTranscriptionRequests.clear();

      // Clear metrics collection interval
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
      }

      // Close all transports
      Array.from(this.transportMap.values()).forEach((transport) => {
        transport.close();
      });
      this.transportMap.clear();

      // Close Redis connection
      await this.redis.quit();
      await new Promise<void>((resolve) => {
        this.redis.once("end", () => resolve());
      });

      // Close mediasoup worker
      await this.mediasoupWorker.close();

      // Close socket.io server
      await new Promise<void>((resolve) => this.io.close(() => resolve()));

      console.log("QuasiPeer server stopped");
    } catch (error) {
      console.error("Error stopping server:", error);
      throw error;
    }
  }

  private initializeTranscriptionNamespace() {
    const namespace = this.io.of("/transcription");

    namespace.on("connection", (socket) => {
      console.log("[Server] New transcription connection:", socket.id);

      socket.on("microphone-state", (enabled: boolean) => {
        console.log(
          "[Server] Microphone state changed for user:",
          socket.id,
          "enabled:",
          enabled
        );

        if (enabled) {
          this.activeMicrophones.add(socket.id);
          console.log("[Server] Microphone activated for user:", socket.id);
        } else {
          this.activeMicrophones.delete(socket.id);

          const stream = this.activeStreams.get(socket.id);
          if (stream) {
            console.log("[Server] Closing stream for user:", socket.id);
            stream.stream.end();
            this.activeStreams.delete(socket.id);
          }
        }
      });

      socket.on("join-room", (roomId: string) => {
        console.log("[Server] User", socket.id, "joining room:", roomId);
        socket.join(roomId);
      });

      socket.on("join-transcription", ({ roomId, userName }) => {
        socket.join(roomId);
        console.log(
          `[Server] Socket ${socket.id} (${userName}) joined room ${roomId}`
        );
      });

      socket.on(
        "audio-data",
        async (data: {
          audioData: Buffer;
          language: string;
          roomId: string;
        }) => {
          console.log(
            "[Server] Received audio data from user:",
            socket.id,
            "size:",
            data.audioData.length
          );

          try {
            let stream = this.activeStreams.get(socket.id);

            if (!stream) {
              console.log(
                "[Server] Creating new gRPC stream for user:",
                socket.id
              );
              stream = {
                stream: this.transcriptionClient.StreamTranscription(),
                userId: socket.id,
                roomId: data.roomId,
              };

              stream.stream.on("data", (response: TranscriptionResponse) => {
                console.log(
                  "[Server] Received transcription result:",
                  response
                );
                if (response.error) {
                  socket.emit("transcription-error", { error: response.error });
                  return;
                }

                // Emit to the specific room
                namespace.to(data.roomId).emit("transcription-result", {
                  text: response.text,
                  confidence: response.confidence,
                  user_id: response.user_id,
                  room_id: response.room_id,
                  is_final: response.is_final,
                  error: response.error || undefined,
                  timestamp: Date.now(),
                });
              });

              stream.stream.on("error", (error: Error) => {
                console.error("[gRPC] Stream error:", error);
                socket.emit("transcription-error", { error: error.message });
                this.activeStreams.delete(socket.id);
              });

              stream.stream.on("end", () => {
                this.activeStreams.delete(socket.id);
              });

              this.activeStreams.set(socket.id, stream);
            }

            // Send the raw buffer directly without conversion
            // The Python service will handle the conversion to numpy array
            console.log("[Server] Sending audio to gRPC service");
            stream.stream.write({
              audio_data: data.audioData, // Send raw buffer
              language: data.language || "en",
              room_id: data.roomId,
              user_id: socket.id,
            });
          } catch (error) {
            console.error("[Server] Error processing audio:", error);
            socket.emit("transcription-error", {
              error: (error as Error).message,
            });
          }
        }
      );

      socket.on("disconnect", () => {
        this.activeMicrophones.delete(socket.id);
        const stream = this.activeStreams.get(socket.id);
        if (stream) {
          stream.stream.end();
          this.activeStreams.delete(socket.id);
        }
      });
    });
  }

  private async setupGRPCClient() {
    try {
      const currentFilePath = fileURLToPath(import.meta.url);
      const protoPath = join(
        dirname(currentFilePath),
        "../../../quasi-peer-system/proto/transcription.proto"
      );

      const packageDefinition = await protoLoader.load(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
      this.transcriptionClient = new (
        protoDescriptor.transcription as any
      ).TranscriptionService(
        "localhost:50051",
        grpc.credentials.createInsecure()
      );

      console.log("gRPC client setup completed");
    } catch (error) {
      console.error("Failed to setup gRPC client:", error);
    }
  }

  // Add new method to handle transcription results
  private handleTranscriptionResult(result: any): void {
    const requestId = result.requestId;
    const resolveFunction = this.pendingTranscriptionRequests.get(requestId);

    if (resolveFunction) {
      this.pendingTranscriptionRequests.delete(requestId);
      if (result.error) {
        console.error("[Server] Transcription error:", result.error);
      } else {
        resolveFunction(result.text || "");
      }
    }
  }
}
