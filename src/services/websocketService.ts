import { io, Socket } from "socket.io-client";

let activeSocket: Socket | null = null;

function connect(serverUrl: string): Socket {
  if (activeSocket) {
    activeSocket.disconnect();
  }
  activeSocket = io(serverUrl, {
    transports: ["websocket"],
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
