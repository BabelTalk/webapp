import { io as Client } from "socket.io-client";
import { Device } from "mediasoup-client";
import { QuasiPeerServer } from "../../src/core/QuasiPeerServer.js";
import {
  Participant,
  ParticipantRole,
  ConnectionInfo,
} from "../../src/types/index.js";
import { jest } from "@jest/globals";

// Mock mediasoup-client Device
jest.mock("mediasoup-client", () => {
  const mockTransport = {
    id: "test-transport-id",
    connect: jest.fn().mockImplementation(() => Promise.resolve()),
    produce: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ id: "test-producer-id" })),
  };

  const mockDevice = {
    load: jest.fn().mockImplementation(() => Promise.resolve()),
    createSendTransport: jest
      .fn()
      .mockImplementation(() => Promise.resolve(mockTransport)),
  };

  return {
    Device: jest.fn().mockImplementation(() => mockDevice),
  };
});

const PORT = process.env.PORT || 3002;
let server: QuasiPeerServer;
let client1: ReturnType<typeof Client>;
let client2: ReturnType<typeof Client>;

describe("QuasiPeer Server Integration Tests", () => {
  beforeAll(async () => {
    server = new QuasiPeerServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
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

  afterEach(() => {
    client1.close();
    client2.close();
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

    client1.on("connect", () => {
      client1.emit(
        "join-meeting",
        "test-meeting",
        participantInfo,
        (response: any) => {
          expect(response.success).toBe(true);
          expect(response.participant.id).toBeDefined();
          done();
        }
      );
    });
  });

  test("should handle WebRTC transport creation", async () => {
    const device = new Device();

    // Wait for connection
    await new Promise<void>((resolve) => {
      client1.on("connect", resolve);
    });

    // Join meeting first
    await new Promise<void>((resolve) => {
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

      client1.emit("join-meeting", "test-meeting", participantInfo, () =>
        resolve()
      );
    });

    // Request transport creation
    const transportOptions = await new Promise<any>((resolve) => {
      client1.emit("create-transport", { type: "send" }, (response: any) => {
        expect(response.success).toBe(true);
        expect(response.transport).toBeDefined();
        resolve(response.transport);
      });
    });

    await device.load({
      routerRtpCapabilities: transportOptions.rtpCapabilities,
    });
    const transport = await device.createSendTransport(transportOptions);
    expect(transport).toBeDefined();
    expect(transport.id).toBe("test-transport-id");
  });

  test("should handle transcription request", async () => {
    // Wait for connection
    await new Promise<void>((resolve) => {
      client1.on("connect", resolve);
    });

    // Join meeting first
    await new Promise<void>((resolve) => {
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

      client1.emit("join-meeting", "test-meeting", participantInfo, () =>
        resolve()
      );
    });

    // Test transcription request
    const response = await new Promise<any>((resolve) => {
      client1.emit(
        "transcribe",
        { audio: Buffer.from("test audio data"), language: "en" },
        (result: any) => resolve(result)
      );
    });

    expect(response.success).toBe(true);
    expect(response.text).toBeDefined();
  });

  test("should handle translation request", async () => {
    // Wait for connection
    await new Promise<void>((resolve) => {
      client1.on("connect", resolve);
    });

    // Join meeting first
    await new Promise<void>((resolve) => {
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

      client1.emit("join-meeting", "test-meeting", participantInfo, () =>
        resolve()
      );
    });

    // Test translation request
    const response = await new Promise<any>((resolve) => {
      client1.emit(
        "translate",
        { text: "Hello", fromLang: "en", toLang: "es" },
        (result: any) => resolve(result)
      );
    });

    expect(response.success).toBe(true);
    expect(response.translation).toBeDefined();
  });
});
