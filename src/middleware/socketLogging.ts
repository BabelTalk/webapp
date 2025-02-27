import { Socket } from "socket.io-client";

export function addSocketLogging(socket: Socket) {
  socket.onAny((event, ...args) => {
    console.log(`[Socket] Event: ${event}`, args);
  });
}
