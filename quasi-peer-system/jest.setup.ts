import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: "./tests/integration/.env.test" });

// Increase timeout for all tests
jest.setTimeout(30000);

// Global test setup
beforeAll(() => {
  // Suppress console logs during tests unless explicitly needed
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

// Global test teardown
afterAll(() => {
  // Restore console
  jest.restoreAllMocks();
});
