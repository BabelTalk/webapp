import { QuasiPeerServer } from "./core/QuasiPeerServer";

async function main() {
  const server = new QuasiPeerServer();

  try {
    await server.start();
    console.log("QuasiPeer system started successfully");

    // Handle graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("Received SIGTERM signal. Shutting down...");
      await server.stop();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("Received SIGINT signal. Shutting down...");
      await server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to start QuasiPeer system:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
