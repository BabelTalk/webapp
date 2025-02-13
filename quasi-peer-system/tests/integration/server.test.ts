import { io as Client, Socket } from "socket.io-client";
import { QuasiPeerServer } from "../../src/core/QuasiPeerServer";
import { Device, Transport } from "mediasoup-client/lib/types";
import { Participant, ParticipantRole } from "../../src/types";
import {
  TransportParameters,
  TranscriptionResult,
  TranslationResult,
} from "./types";

// Mock mediasoup-client Device with proper capabilities
jest.mock("mediasoup-client", () => {
  const mockTransport = {
    id: "test-transport-id",
    connect: jest.fn().mockResolvedValue(undefined),
    produce: jest.fn().mockResolvedValue({ id: "test-producer-id" }),
    on: jest.fn((event, callback) => {
      if (event === "connect") {
        setTimeout(() => callback({ dtlsParameters: {} }, () => {}), 100);
      }
      if (event === "produce") {
        setTimeout(
          () =>
            callback({ kind: "audio", rtpParameters: {} }, (id: string) => {}),
          100
        );
      }
    }),
  };

  return {
    Device: jest.fn().mockImplementation(() => ({
      load: jest.fn().mockResolvedValue(undefined),
      createSendTransport: jest.fn().mockReturnValue(mockTransport),
      rtpCapabilities: { codecs: [] },
    })),
  };
});

describe("QuasiPeer Server Integration Tests", () => {
  let server: QuasiPeerServer;
  let client1: Socket;
  let client2: Socket;
  const PORT = 3001;
  const TEST_MEETING_ID = "test-meeting";

  beforeAll(async () => {
    server = new QuasiPeerServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    // Ensure all connections are closed
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  beforeEach(() => {
    client1 = Client(`http://localhost:${PORT}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    client2 = Client(`http://localhost:${PORT}`, {
      transports: ["websocket"],
      forceNew: true,
    });
  });

  afterEach(async () => {
    if (client1.connected) client1.close();
    if (client2.connected) client2.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("should connect to server", (done) => {
    client1.on("connect", () => {
      expect(client1.connected).toBe(true);
      done();
    });
  });

  test("should join meeting", (done) => {
    const participantInfo: Partial<Participant> = {
      preferredLanguage: "en",
      role: ParticipantRole.PARTICIPANT,
      connectionInfo: {
        ip: "127.0.0.1",
        userAgent: "test-agent",
        bandwidth: 1000000,
        latency: 50,
      },
    };

    client1.emit("join-meeting", {
      meetingId: TEST_MEETING_ID,
      participantInfo,
    });

    client1.on("transport-parameters", (params: TransportParameters) => {
      expect(params).toHaveProperty("id");
      expect(params).toHaveProperty("iceParameters");
      expect(params).toHaveProperty("iceCandidates");
      expect(params).toHaveProperty("dtlsParameters");
      done();
    });
  });

  test("should handle WebRTC transport creation", async () => {
    const device = new Device();

    // Wait for server connection
    await new Promise<void>((resolve) => {
      client1.on("connect", resolve);
    });

    const joinPromise = new Promise<Transport>((resolve) => {
      client1.emit("join-meeting", {
        meetingId: TEST_MEETING_ID,
        participantInfo: {
          preferredLanguage: "en",
          role: ParticipantRole.PARTICIPANT,
          connectionInfo: {
            ip: "127.0.0.1",
            userAgent: "test-agent",
            bandwidth: 1000000,
            latency: 50,
          },
        },
      });

      client1.on(
        "transport-parameters",
        async (params: TransportParameters) => {
          await device.load({ routerRtpCapabilities: { codecs: [] } });
          const transport = device.createSendTransport(params);
          resolve(transport);
        }
      );
    });

    const transport = await joinPromise;
    expect(transport).toBeDefined();
    expect(transport.id).toBe("test-transport-id");
  });

  test("should handle transcription request", (done) => {
    let timeoutId: NodeJS.Timeout;

    // Wait for connection before sending request
    client1.on("connect", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      client1.emit("join-meeting", {
        meetingId: TEST_MEETING_ID,
        participantInfo: {
          preferredLanguage: "en",
          role: ParticipantRole.PARTICIPANT,
          connectionInfo: {
            ip: "127.0.0.1",
            userAgent: "test-agent",
            bandwidth: 1000000,
            latency: 50,
          },
        },
      });

      // Wait for join confirmation
      client1.on("joined-meeting", () => {
        const audioData = Buffer.from("test audio data");
        client1.emit("transcription-request", audioData);
      });
    });

    client1.on("transcription-result", (result: TranscriptionResult) => {
      clearTimeout(timeoutId);
      expect(result).toBeDefined();
      done();
    });

    // Increase timeout for transcription
    timeoutId = setTimeout(() => {
      done(new Error("Transcription timeout"));
    }, 8000);
  });

  test("should handle translation request", (done) => {
    let timeoutId: NodeJS.Timeout;

    // Wait for connection before sending request
    client1.on("connect", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      client1.emit("join-meeting", {
        meetingId: TEST_MEETING_ID,
        participantInfo: {
          preferredLanguage: "en",
          role: ParticipantRole.PARTICIPANT,
          connectionInfo: {
            ip: "127.0.0.1",
            userAgent: "test-agent",
            bandwidth: 1000000,
            latency: 50,
          },
        },
      });

      // Wait for join confirmation
      client1.on("joined-meeting", () => {
        client1.emit("translation-request", {
          text: "Hello, world!",
          targetLanguage: "es",
        });
      });
    });

    client1.on("translation-result", (result: TranslationResult) => {
      clearTimeout(timeoutId);
      expect(result).toBeDefined();
      done();
    });

    // Increase timeout for translation
    timeoutId = setTimeout(() => {
      done(new Error("Translation timeout"));
    }, 8000);
  });
});
