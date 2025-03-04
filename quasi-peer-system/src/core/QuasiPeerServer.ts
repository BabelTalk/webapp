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
} from "../types";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import axios from "axios";
import WebSocket from "ws";

interface PendingTranscriptionRequest {
  requestId: string;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
}

export class QuasiPeerServer {
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
  private isMicrophoneActive: boolean = false;

  private setupHealthCheck(): void {
    this.httpsServer.on("request", (req, res) => {
      if (req.url === "/health") {
        const healthStatus = {
          status: "ok",
          timestamp: new Date().toISOString(),
          services: {
            redis: this.redis.status === "ready",
            mediasoup: !!this.mediasoupWorker && !this.mediasoupWorker.closed,
            socketio: this.io.engine.clientsCount >= 0,
          },
          metrics: {
            activeParticipants: this.metrics.activeParticipants,
            activeTranscriptions: this.metrics.activeTranscriptions,
            activeTranslations: this.metrics.activeTranslations,
            cpuUsage: this.metrics.cpuUsage,
            memoryUsage: this.metrics.memoryUsage,
          },
        };

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(healthStatus, null, 2));
        return;
      }
    });
  }

  constructor() {
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
    this.setupHealthCheck();
    this.setupMediasoup();
    this.setupAIPipelines();
    this.setupSocketHandlers();
    this.startMetricsCollection();

    // Initialize transcription namespace
    this.transcriptionNamespace = this.io.of("/transcription");
    this.initializeTranscriptionNamespace();
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

  private async setupAIPipelines(): Promise<void> {
    try {
      await this.setupAIWebSocket();
      console.log("AI service WebSocket initialized");
    } catch (error) {
      console.error("Error initializing AI service:", error);
      throw error;
    }
  }

  private async setupAIWebSocket(): Promise<void> {
    if (this.aiWebSocket) {
      this.aiWebSocket.removeAllListeners();
      this.aiWebSocket.terminate();
      this.aiWebSocket = null;
    }

    return new Promise((resolve, reject) => {
      this.aiWebSocket = new WebSocket("ws://localhost:5000/ws/transcribe");

      const connectionTimeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
      }, 5000);

      this.aiWebSocket.on("open", () => {
        console.log("[Server] Connected to AI service via WebSocket");
        clearTimeout(connectionTimeout);
        if (this.wsReconnectInterval) {
          clearInterval(this.wsReconnectInterval);
          this.wsReconnectInterval = null;
        }
        resolve();
      });

      this.aiWebSocket.on("message", (data: WebSocket.Data) => {
        try {
          const result = JSON.parse(data.toString());
          this.handleTranscriptionResult(result);
        } catch (error) {
          console.error("[Server] Error parsing WebSocket message:", error);
        }
      });

      this.aiWebSocket.on("error", (error) => {
        console.error("[Server] WebSocket error:", error);
        reject(error);
      });

      this.aiWebSocket.on("close", () => {
        console.log(
          "[Server] WebSocket connection closed, attempting to reconnect..."
        );
        if (!this.wsReconnectInterval) {
          this.wsReconnectInterval = setInterval(() => {
            this.setupAIWebSocket().catch(console.error);
          }, 5000);
        }
      });
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

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket) => {
      console.log("New connection:", socket.id);

      socket.on("join-meeting", this.handleJoinMeeting.bind(this, socket));
      socket.on("leave-meeting", this.handleLeaveMeeting.bind(this, socket));
      socket.on(
        "connect-transport",
        this.handleConnectTransport.bind(this, socket)
      );
      socket.on("produce", this.handleProduce.bind(this, socket));
      socket.on("consume", this.handleConsume.bind(this, socket));
      socket.on(
        "transcription-request",
        this.handleTranscriptionRequest.bind(this, socket)
      );
      socket.on(
        "translation-request",
        this.handleTranslationRequest.bind(this, socket)
      );
      socket.on("disconnect", this.handleDisconnect.bind(this, socket));
    });
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
    this.transcriptionNamespace.on("connection", (socket: Socket) => {
      console.log("[Server] New transcription connection:", socket.id);

      socket.on(
        "audio-data",
        async (data: {
          meetingId: string;
          userId: string;
          userName: string;
          audioData: number[];
          timestamp: number;
          language: string;
        }) => {
          // Only process audio if microphone is active
          if (!this.isMicrophoneActive) {
            return;
          }

          try {
            console.log(
              `[Server] Received audio data from ${data.userName} in meeting ${data.meetingId}`
            );

            const audioFloat32 = new Float32Array(data.audioData);
            const transcription = await this.processAudioForTranscription(
              audioFloat32,
              data.language
            );

            if (transcription && transcription.trim()) {
              const date = new Date(data.timestamp);
              const formattedTime = date.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
              });

              this.transcriptionNamespace
                .to(data.meetingId)
                .emit("transcription-result", {
                  userId: data.userId,
                  userName: data.userName,
                  text: transcription.trim(),
                  timestamp: formattedTime,
                  rawTimestamp: data.timestamp,
                });
            }
          } catch (error) {
            // Only log error if microphone is still active
            if (this.isMicrophoneActive) {
              console.error("[Server] Error processing audio data:", error);
              socket.emit("error", {
                message: "Failed to process audio data",
                details: (error as Error).message,
              });
            }
          }
        }
      );

      // Add handlers for microphone state
      socket.on("microphone-state", (isEnabled: boolean) => {
        this.isMicrophoneActive = isEnabled;
        if (!isEnabled) {
          this.cleanupTranscriptionRequests();
        }
      });

      socket.on("join-transcription-room", (meetingId: string) => {
        socket.join(meetingId);
        console.log(
          `[Server] Socket ${socket.id} joined transcription room ${meetingId}`
        );
      });

      socket.on("disconnect", () => {
        console.log("[Server] Transcription connection closed:", socket.id);
        this.cleanupTranscriptionRequests();
      });
    });
  }

  // Add new method to cleanup pending requests
  private cleanupTranscriptionRequests(): void {
    console.log("[Server] Cleaning up pending transcription requests");
    // Clear all pending requests
    this.pendingTranscriptionRequests.forEach((resolve, requestId) => {
      resolve(""); // Resolve with empty string to prevent timeout errors
    });
    this.pendingTranscriptionRequests.clear();
  }

  private async processAudioForTranscription(
    audioData: Float32Array,
    language: string
  ): Promise<string> {
    // Don't process if microphone is disabled
    if (!this.isMicrophoneActive) {
      return "";
    }

    try {
      if (!this.aiWebSocket || this.aiWebSocket.readyState !== WebSocket.OPEN) {
        console.log(
          "[Server] WebSocket not connected, attempting to reconnect..."
        );
        await this.setupAIWebSocket();

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("WebSocket connection timeout"));
          }, 5000);

          const checkConnection = setInterval(() => {
            if (this.aiWebSocket?.readyState === WebSocket.OPEN) {
              clearInterval(checkConnection);
              clearTimeout(timeout);
              resolve();
            }
          }, 100);
        });
      }

      return new Promise((resolve, reject) => {
        // Don't process if microphone is disabled
        if (!this.isMicrophoneActive) {
          resolve("");
          return;
        }

        const requestId = `${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        const timeoutId = setTimeout(() => {
          if (this.pendingTranscriptionRequests.has(requestId)) {
            this.pendingTranscriptionRequests.delete(requestId);
            // Only reject if microphone is still active
            if (this.isMicrophoneActive) {
              reject(new Error("Transcription request timed out"));
            } else {
              resolve("");
            }
          }
        }, 15000);

        this.pendingTranscriptionRequests.set(requestId, (result: any) => {
          clearTimeout(timeoutId);
          resolve(result);
        });

        const message = {
          requestId,
          audioData: Array.from(audioData),
          language,
        };

        try {
          this.aiWebSocket!.send(JSON.stringify(message));
        } catch (error) {
          clearTimeout(timeoutId);
          this.pendingTranscriptionRequests.delete(requestId);
          reject(
            new Error(`Failed to send audio data: ${(error as Error).message}`)
          );
        }
      });
    } catch (error) {
      // Only log error if microphone is still active
      if (this.isMicrophoneActive) {
        console.error("[Server] Error in processAudioForTranscription:", error);
      }
      throw error;
    }
  }

  private resampleAudio(
    audioData: Float32Array,
    fromSampleRate: number,
    toSampleRate: number
  ): Float32Array {
    if (fromSampleRate === toSampleRate) {
      return audioData;
    }
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const pos = i * ratio;
      const index = Math.floor(pos);
      const fraction = pos - index;

      if (index + 1 < audioData.length) {
        result[i] =
          audioData[index] * (1 - fraction) + audioData[index + 1] * fraction;
      } else {
        result[i] = audioData[index];
      }
    }

    return result;
  }

  private normalizeAudio(audioData: Float32Array): Float32Array {
    // Find maximum amplitude
    let maxAmplitude = 0;
    for (let i = 0; i < audioData.length; i++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(audioData[i]));
    }

    // More aggressive normalization for quiet audio
    if (maxAmplitude < 0.3) {
      // Increased threshold
      const gain = 0.7 / maxAmplitude; // Target 70% amplitude (increased from 50%)
      const normalized = new Float32Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        normalized[i] = audioData[i] * gain;
      }
      return normalized;
    }

    return audioData;
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
