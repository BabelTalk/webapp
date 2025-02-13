import { Server } from "socket.io";
import { createServer } from "http";
import Redis from "ioredis";
import * as mediasoup from "mediasoup";
import { types as mediasoupTypes } from "mediasoup";
import { config } from "../config/config";
import type {
  Participant,
  MediaStream,
  TranscriptionResult,
  TranslationResult,
  ServerMetrics,
} from "../types";

export class QuasiPeerServer {
  private io: Server;
  private redis: Redis;
  private participants: Map<string, Participant>;
  private metrics: ServerMetrics;
  private mediasoupWorker!: mediasoupTypes.Worker;
  private mediasoupRouter!: mediasoupTypes.Router;
  private transportMap = new Map<string, mediasoupTypes.WebRtcTransport>();

  constructor() {
    const httpServer = createServer();
    this.io = new Server(httpServer, {
      cors: {
        origin: "*", // Configure appropriately for production
        methods: ["GET", "POST"],
      },
    });

    this.redis = new Redis(config.redisUrl);
    this.participants = new Map();
    this.metrics = this.initializeMetrics();

    this.setupMediasoup();
    this.setupSocketHandlers();
    this.startMetricsCollection();
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

        // Update metrics
        this.metrics.activeParticipants = this.participants.size;

        // Remove from Redis
        await this.redis.hdel(`meeting:${participant.meetingId}`, socket.id);
      }
    } catch (error) {
      console.error("Error in handleLeaveMeeting:", error);
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
      if (!participant) return;

      this.metrics.activeTranscriptions++;

      // Process transcription (implement with chosen AI service)
      const result: TranscriptionResult = await this.processTranscription(
        audioData
      );

      socket.emit("transcription-result", result);
      this.metrics.activeTranscriptions--;
    } catch (error) {
      console.error("Error in handleTranscriptionRequest:", error);
      this.metrics.errorRate++;
      this.metrics.activeTranscriptions--;
    }
  }

  private async handleTranslationRequest(
    socket: any,
    data: { text: string; targetLanguage: string }
  ): Promise<void> {
    try {
      const participant = this.participants.get(socket.id);
      if (!participant) return;

      this.metrics.activeTranslations++;

      // Process translation (implement with chosen AI service)
      const result: TranslationResult = await this.processTranslation(data);

      socket.emit("translation-result", result);
      this.metrics.activeTranslations--;
    } catch (error) {
      console.error("Error in handleTranslationRequest:", error);
      this.metrics.errorRate++;
      this.metrics.activeTranslations--;
    }
  }

  private async processTranscription(
    audioData: Buffer
  ): Promise<TranscriptionResult> {
    // Implement transcription using chosen AI service
    throw new Error("Not implemented");
  }

  private async processTranslation(data: {
    text: string;
    targetLanguage: string;
  }): Promise<TranslationResult> {
    // Implement translation using chosen AI service
    throw new Error("Not implemented");
  }

  private updateBandwidthMetrics(stream: MediaStream): void {
    // Update network bandwidth metrics based on stream bitrate
    this.metrics.networkBandwidth += stream.bitrate;
  }

  private startMetricsCollection(): void {
    setInterval(() => {
      // Collect and update system metrics
      this.updateSystemMetrics();

      // Publish metrics to Redis for monitoring
      this.redis.hset("metrics", this.metrics);
    }, 5000); // Update every 5 seconds
  }

  private updateSystemMetrics(): void {
    // Update CPU and memory usage metrics
    // Implement based on chosen monitoring solution
  }

  public async start(): Promise<void> {
    try {
      await this.redis.ping();
      await this.setupMediasoup();
      this.io.listen(config.port);
      console.log(`QuasiPeer server listening on port ${config.port}`);
    } catch (error) {
      console.error("Failed to start server:", error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      await this.redis.quit();
      await this.mediasoupWorker.close();
      await new Promise((resolve) => this.io.close(resolve));
      console.log("QuasiPeer server stopped");
    } catch (error) {
      console.error("Error stopping server:", error);
      throw error;
    }
  }
}
