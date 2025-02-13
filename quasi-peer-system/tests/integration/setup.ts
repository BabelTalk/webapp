import dotenv from "dotenv";
import Redis from "ioredis";
import "@types/jest";

// Load test environment variables
dotenv.config({ path: ".env.test" });

// Create Redis instance with proper error handling
const redis = new Redis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null, // Disable retries
  lazyConnect: true, // Don't connect immediately
});

beforeAll(async () => {
  try {
    // Try to connect to Redis
    await redis.connect();
    // Clear Redis before tests
    await redis.flushall();
  } catch (error) {
    console.warn("Redis not available:", (error as Error).message);
  }
});

afterAll(async () => {
  try {
    // Disconnect Redis
    await redis.quit();
    await new Promise<void>((resolve) => {
      redis.once("end", () => resolve());
    });
  } catch (error) {
    console.warn("Redis disconnect error:", (error as Error).message);
  }
});

// Increase timeout for all tests
jest.setTimeout(30000);

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
