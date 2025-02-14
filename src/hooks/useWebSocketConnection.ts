import { useState, useCallback, useRef, useEffect } from "react";
import { Socket, io } from "socket.io-client";

interface UseWebSocketConnectionOptions {
  url: string;
  roomId: string;
  userName: string;
  onParticipantJoined?: (participant: any) => void;
  onParticipantLeft?: (participantId: string) => void;
  onPeerError?: (error: Error) => void;
  onConnectionError?: (error: Error) => void;
}

export function useWebSocketConnection({
  url,
  roomId,
  userName,
  onParticipantJoined,
  onParticipantLeft,
  onPeerError,
  onConnectionError,
}: UseWebSocketConnectionOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectionAttempts, setReconnectionAttempts] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_RECONNECTION_ATTEMPTS = 3;

  const connect = useCallback(() => {
    try {
      socketRef.current = io(url, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECTION_ATTEMPTS,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      socketRef.current.on("connect", () => {
        setIsConnected(true);
        setIsReconnecting(false);
        setReconnectionAttempts(0);

        // Join room
        socketRef.current?.emit("join-room", {
          roomId,
          userName,
          timestamp: Date.now(),
        });

        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          socketRef.current?.emit("heartbeat", { timestamp: Date.now() });
        }, 30000);
      });

      socketRef.current.on("disconnect", () => {
        setIsConnected(false);
        handleReconnection();
      });

      socketRef.current.on("connect_error", (error) => {
        console.error("Socket connection error:", error);
        onConnectionError?.(error);
        handleReconnection();
      });

      socketRef.current.on("participant-joined", (participant) => {
        onParticipantJoined?.(participant);
      });

      socketRef.current.on("participant-left", (participantId) => {
        onParticipantLeft?.(participantId);
      });

      socketRef.current.on("peer-error", (error) => {
        console.error("Peer connection error:", error);
        onPeerError?.(error);
      });

      // Handle server heartbeat response
      socketRef.current.on(
        "heartbeat-ack",
        ({ timestamp, serverTimestamp }) => {
          const latency = Date.now() - timestamp;
          const clockDrift = serverTimestamp - timestamp - latency / 2;
          console.debug(`Latency: ${latency}ms, Clock drift: ${clockDrift}ms`);
        }
      );
    } catch (error) {
      console.error("Error initializing socket connection:", error);
      onConnectionError?.(error as Error);
    }
  }, [
    url,
    roomId,
    userName,
    onParticipantJoined,
    onParticipantLeft,
    onPeerError,
    onConnectionError,
  ]);

  const handleReconnection = useCallback(() => {
    if (reconnectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
      console.error("Max reconnection attempts reached");
      return;
    }

    setIsReconnecting(true);
    setReconnectionAttempts((prev) => prev + 1);

    // Clear existing heartbeat interval
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    // Attempt to reconnect
    setTimeout(() => {
      connect();
    }, Math.min(1000 * Math.pow(2, reconnectionAttempts), 5000));
  }, [connect, reconnectionAttempts]);

  const disconnect = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    socketRef.current?.disconnect();
    socketRef.current = null;
    setIsConnected(false);
    setIsReconnecting(false);
    setReconnectionAttempts(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    socket: socketRef.current,
    isConnected,
    isReconnecting,
    reconnectionAttempts,
    connect,
    disconnect,
  };
}
