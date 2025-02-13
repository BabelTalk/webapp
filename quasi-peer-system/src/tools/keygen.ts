import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

function generateSecureKey(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("base64");
}

function updateEnvFile(
  envFilePath: string,
  jwtSecret: string,
  encryptionKey: string
): void {
  console.log("Updating .env file at", envFilePath);
  let envContent = "";

  // Read existing .env file if it exists
  try {
    envContent = fs.readFileSync(envFilePath, "utf8");
  } catch (error) {
    console.log("No existing .env file found. Creating new one.");
  }

  // Prepare new content
  const lines = envContent.split("\n");
  const newLines = lines.map((line) => {
    if (line.startsWith("JWT_SECRET=")) {
      return `JWT_SECRET=${jwtSecret}`;
    }
    if (line.startsWith("ENCRYPTION_KEY=")) {
      return `ENCRYPTION_KEY=${encryptionKey}`;
    }
    return line;
  });

  // If keys don't exist, add them
  if (!lines.some((line) => line.startsWith("JWT_SECRET="))) {
    newLines.push(`JWT_SECRET=${jwtSecret}`);
  }
  if (!lines.some((line) => line.startsWith("ENCRYPTION_KEY="))) {
    newLines.push(`ENCRYPTION_KEY=${encryptionKey}`);
  }

  // Write back to .env file
  fs.writeFileSync(envFilePath, newLines.join("\n"));
  console.log("Generated new keys and updated .env file");
  console.log(
    "JWT_SECRET length:",
    Buffer.from(jwtSecret, "base64").length,
    "bytes"
  );
  console.log(
    "ENCRYPTION_KEY length:",
    Buffer.from(encryptionKey, "base64").length,
    "bytes"
  );
}

const jwtSecret = generateSecureKey(64);
const encryptionKey = generateSecureKey(32);

const mainEnvPath = path.join(__dirname, "..", "..", ".env");
const testEnvPath = path.join(
  __dirname,
  "..",
  "..",
  "tests",
  "integration",
  ".env.test"
);

updateEnvFile(mainEnvPath, jwtSecret, encryptionKey);
updateEnvFile(testEnvPath, jwtSecret, encryptionKey);
