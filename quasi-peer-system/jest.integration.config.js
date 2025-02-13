module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/integration/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/integration/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
      },
    ],
  },
  testTimeout: 10000,
  verbose: true,
  detectOpenHandles: true,
  forceExit: true,
  maxConcurrency: 1,
  maxWorkers: 1,
};
