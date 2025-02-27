import { io, Socket } from "socket.io-client";

let activeSocket: Socket | null = null;

function connect(serverUrl: string): Socket {
  console.log(`Attempting to connect to WebSocket server: ${serverUrl}`);

  if (activeSocket) {
    console.log("Cleaning up existing socket connection before reconnecting");
    try {
      activeSocket.disconnect();
    } catch (err) {
      console.warn("Error disconnecting existing socket:", err);
    }
  }

  const connectionOptions = {
    transports: ["websocket"],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: true,
  };

  console.log("Creating socket with options:", connectionOptions);
  activeSocket = io(serverUrl, connectionOptions);

  // Add basic built-in event handlers
  activeSocket.on("connect", () => {
    console.log("WebSocket connected successfully (internal service)");
  });

  activeSocket.on("disconnect", (reason) => {
    console.log("WebSocket disconnected (internal service):", reason);
  });

  activeSocket.on("connect_error", (error) => {
    console.error("WebSocket connection error (internal service):", error);
  });

  return activeSocket;
}

function disconnect() {
  if (activeSocket) {
    activeSocket.disconnect();
    activeSocket = null;
  }
}

const websocketService = {
  connect,
  disconnect,
};

export default websocketService;
