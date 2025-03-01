import { Server } from "socket.io";
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
      // Dynamic imports for ES modules
      const transformers = await import("@xenova/transformers");
      const { pipeline, env } = transformers;

      // Enable caching
      env.cacheDir = "./models-cache";
      env.localModelPath = "./models-cache";

      // Progress callback for model downloads
      const progressCallback = (progress: {
        status: string;
        progress?: number;
        file?: string;
      }) => {
        switch (progress.status) {
          case "downloading":
            console.log(
              `Downloading: ${progress.file} (${Math.round(
                progress.progress! * 100
              )}%)`
            );
            break;
          case "loading":
            console.log(
              `Loading model: ${Math.round(progress.progress! * 100)}%`
            );
            break;
          case "ready":
            console.log("Model is ready");
            break;
          // default:
          //   console.log(`Status: ${progress.status}`);
        }
      };

      // Initialize Whisper model for speech recognition
      console.log("Loading Whisper model for speech recognition...");
      this.speechRecognitionPipeline = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-small",
        {
          quantized: true,
          progress_callback: progressCallback,
        }
      );

      // Initialize a single mBART model for all language pairs
      console.log("Loading mBART model for translation...");
      try {
        const translationPipeline = await pipeline(
          "translation",
          "Xenova/mbart-large-50-many-to-many-mmt",
          {
            quantized: true,
            progress_callback: progressCallback,
          }
        );
        // Store the same pipeline instance for all language pairs
        for (const langPair of Object.keys(this.supportedTranslations)) {
          this.translationPipelines.set(langPair, translationPipeline);
        }
        console.log("Successfully loaded mBART translation model");
      } catch (error) {
        console.error("Failed to load translation model:", error);
      }

      // Initialize summarization model
      console.log("Loading DistilBART model for summarization...");
      this.summaryPipeline = await pipeline(
        "summarization",
        "Xenova/distilbart-cnn-6-6",
        {
          quantized: true,
          progress_callback: progressCallback,
        }
      );

      console.log("AI pipelines initialized successfully");
    } catch (error) {
      console.error("Error initializing AI pipelines:", error);
      throw error;
    }
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
      // Convert audio buffer to Float32Array
      const audioFloat32 = new Float32Array(audioData.buffer);

      // Process audio through Whisper model
      const result = await this.speechRecognitionPipeline(audioFloat32, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: "en",
        return_timestamps: true,
      });

      return {
        text: result.text,
        confidence: result.confidence || 0.95,
        language: result.language || "en",
        timestamp: Date.now(),
        participantId: "test-participant",
      };
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
      const sourceLanguage = "en"; // Default source language
      const targetLanguage = data.targetLanguage;

      // Get the mBART language codes
      const sourceMbartCode =
        this.mbartLanguageCodes[sourceLanguage] || sourceLanguage;
      const targetMbartCode =
        this.mbartLanguageCodes[targetLanguage] || targetLanguage;

      // Get the translation pipeline
      const langPair = `${sourceLanguage}-${targetLanguage}`;
      let translationPipeline = this.translationPipelines.get(langPair);

      if (!translationPipeline) {
        if (!this.translationPipelines.has(langPair)) {
          throw new Error(`Unsupported language pair: ${langPair}`);
        }
      }

      // Perform the translation with proper language codes
      const result = await translationPipeline(data.text, {
        src_lang: sourceMbartCode,
        tgt_lang: targetMbartCode,
        max_length: 400,
      });

      return {
        text: data.text,
        translatedText: result[0].translation_text,
        confidence: result[0].score || 0.95,
        language: sourceLanguage,
        originalLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
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
      // Get all transcriptions for the meeting
      const transcriptions = await this.redis.lrange(
        `meeting:${meetingId}:transcriptions`,
        0,
        -1
      );

      if (transcriptions.length === 0) {
        throw new Error("No transcriptions found for meeting");
      }

      // Combine all transcriptions into one text
      const parsedTranscriptions = transcriptions.map((t) => JSON.parse(t));
      const fullText = parsedTranscriptions.map((t) => t.text).join(" ");
      const firstTranscriptionTime = parsedTranscriptions[0].timestamp;

      // Generate summary using the AI model
      const summary = await this.summaryPipeline(fullText, {
        max_length: 130,
        min_length: 30,
      });

      const meetingSummary: MeetingSummary = {
        meetingId,
        duration: Date.now() - firstTranscriptionTime,
        participants: Array.from(
          new Set(parsedTranscriptions.map((t) => t.participantId))
        ),
        topics: [], // Extract topics using NLP if needed
        keyPoints: [summary[0].summary_text],
        actionItems: [], // Extract action items using NLP if needed
      };

      // Store the summary in Redis
      await this.redis.setex(
        `meeting:${meetingId}:summary`,
        86400, // 24 hours TTL
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
}
