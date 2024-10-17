import { Server as HTTPServer } from "http";
import { NextApiRequest, NextApiResponse } from "next";
import { Server as ServerIO } from "socket.io";
import { NextApiResponseServerIO } from "@/types/next";

// Users in different rooms
const users: { [key: string]: string[] } = {};

const ioHandler = (req: NextApiRequest, res: NextApiResponseServerIO) => {
  console.log("ioHandler called");

  if (!res.socket) {
    console.error("Socket not found on response object");
    res.status(500).send("Socket not found on response object");
    return;
  }

  if (!res.socket.server) {
    console.error("Server not found on socket object");
    res.status(500).send("Server not found on socket object");
    return;
  }

  // Check if Socket.IO is already attached to the server
  if (!res.socket.server.io) {
    console.log("Initializing new Socket.IO server");

    // Cast the server to HTTPServer type to avoid type errors
    const httpServer: HTTPServer = res.socket.server;

    // Initialize a new Socket.IO server
    const io = new ServerIO(httpServer, {
      path: "pages/api/socket",
    });

    io.on("connection", (socket) => {
      console.log("New socket connection established");

      // Handle joining a room
      socket.on("join room", (roomID: string) => {
        console.log(`Socket ${socket.id} joining room ${roomID}`);

        if (users[roomID]) {
          users[roomID].push(socket.id);
        } else {
          users[roomID] = [socket.id];
        }

        const usersInThisRoom = users[roomID].filter((id) => id !== socket.id);
        socket.emit("all users", usersInThisRoom);

        // Notify other users in the room
        socket.to(roomID).emit("user joined", {
          signal: null,
          callerID: socket.id,
        });
      });

      // Handle sending a signal
      socket.on("sending signal", (payload) => {
        console.log(
          `Socket ${socket.id} sending signal to ${payload.userToSignal}`
        );
        io.to(payload.userToSignal).emit("user joined", {
          signal: payload.signal,
          callerID: payload.callerID,
        });
      });

      // Handle returning a signal
      socket.on("returning signal", (payload) => {
        console.log(
          `Socket ${socket.id} returning signal to ${payload.callerID}`
        );
        io.to(payload.callerID).emit("receiving returned signal", {
          signal: payload.signal,
          id: socket.id,
        });
      });

      // Handle disconnecting
      socket.on("disconnect", () => {
        console.log(`Socket ${socket.id} disconnected`);
        Object.keys(users).forEach((roomID) => {
          users[roomID] = users[roomID].filter((id) => id !== socket.id);
          if (users[roomID].length === 0) {
            delete users[roomID];
          } else {
            socket.to(roomID).emit("user left", socket.id);
          }
        });
      });
    });

    // Attach the Socket.IO instance to the server to prevent re-initialization
    res.socket.server.io = io;
  } else {
    console.log("Socket.IO server already initialized");
  }

  // End the API route response
  res.end();
};

export default ioHandler;
