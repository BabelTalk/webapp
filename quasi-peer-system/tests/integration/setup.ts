import dotenv from "dotenv";
import Redis from "ioredis";

// Load test environment variables
dotenv.config({ path: "./tests/integration/.env.test" });

// Mock Redis
const mockRedis = new Redis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null, // Disable retries
});

// Increase timeout for all tests
jest.setTimeout(10000);

beforeAll(async () => {
  // Clear Redis before tests
  try {
    await mockRedis.flushall();
  } catch (error) {
    console.warn("Redis not available:", (error as Error).message);
  }
});

afterAll(async () => {
  try {
    await mockRedis.quit();
  } catch (error) {
    console.warn("Redis disconnect error:", (error as Error).message);
  }
});

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
