import { useEffect, useState, useCallback } from "react";
import { Socket } from "socket.io-client";
import webSocketService from "../services/websocketService";
import { addSocketLogging } from "../middleware/socketLogging";

export const useWebSocketConnection = (
  serverUrl: string,
  enableLogging = false
) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectionAttempts, setReconnectionAttempts] = useState(0);

  const connect = useCallback(async () => {
    if (socket) {
      socket.connect();
    }
  }, [socket]);

  const disconnect = useCallback(() => {
    if (socket) {
      socket.disconnect();
    }
  }, [socket]);

  useEffect(() => {
    const finalUrl = serverUrl || "http://localhost:3004";

    if (!finalUrl) {
      console.warn("WebSocket server URL not provided");
      return;
    }

    try {
      console.log("Connecting to WebSocket server:", finalUrl);
      const socketInstance = webSocketService.connect(finalUrl);

      if (enableLogging) {
        addSocketLogging(socketInstance);
      }

      const onConnect = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setIsReconnecting(false);
        setReconnectionAttempts(0);
        setError(null);
      };

      const onDisconnect = (reason: string) => {
        console.log("WebSocket disconnected:", reason);
        setIsConnected(false);
        setReconnectionAttempts((prev) => prev + 1);
        setIsReconnecting(true);
      };

      const onError = (err: Error) => {
        console.error("WebSocket error:", err);
        setError(err);
      };

      socketInstance.on("connect", onConnect);
      socketInstance.on("disconnect", onDisconnect);
      socketInstance.on("error", onError);

      // Initial state
      setIsConnected(socketInstance.connected);
      setSocket(socketInstance);

      return () => {
        console.log("Removing socket event listeners");
        socketInstance.off("connect", onConnect);
        socketInstance.off("disconnect", onDisconnect);
        socketInstance.off("error", onError);
      };
    } catch (err) {
      console.error("Error setting up WebSocket:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
      return () => {};
    }
  }, [serverUrl, enableLogging]);

  return {
    socket,
    isConnected,
    error,
    isReconnecting,
    reconnectionAttempts,
    connect,
    disconnect,
  };
};
