import { Server as HTTPServer } from "http";
import { NextApiRequest } from "next";
import { Server as ServerIO } from "socket.io";
import { NextApiResponseServerIO } from "@/types/next";

export const config = {
  api: {
    bodyParser: false,
  },
};

interface User {
  id: string;
  userName: string;
}

// Users in different rooms
const rooms: { [key: string]: User[] } = {};

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
      path: "/api/socket/io",
      addTrailingSlash: false,
      transports: ["websocket", "polling"],
    });

    io.on("connection", (socket) => {
      console.log("New socket connection established");

      // Add rate limiting
      let messageCount = 0;
      let resetTime = Date.now();
      const MAX_MESSAGES = 100;
      const RESET_INTERVAL = 60000; // 1 minute

      const checkRateLimit = () => {
        if (Date.now() - resetTime > RESET_INTERVAL) {
          messageCount = 0;
          resetTime = Date.now();
          return true;
        }
        return messageCount++ < MAX_MESSAGES;
      };

      socket.on(
        "join room",
        ({ roomID, userName }: { roomID: string; userName: string }) => {
          // Validate input
          if (
            typeof roomID !== "string" ||
            typeof userName !== "string" ||
            !roomID.match(/^[a-zA-Z0-9-_]+$/) ||
            userName.length > 50
          ) {
            socket.emit("error", { message: "Invalid input" });
            return;
          }

          if (!checkRateLimit()) {
            socket.emit("error", { message: "Rate limit exceeded" });
            return;
          }

          if (rooms[roomID]) {
            // Check room size limit
            if (rooms[roomID].length >= 50) {
              // Limit to 50 users per room
              socket.emit("error", { message: "Room is full" });
              return;
            }
            rooms[roomID].push({ id: socket.id, userName });
          } else {
            rooms[roomID] = [{ id: socket.id, userName }];
          }
          const usersInThisRoom = rooms[roomID].filter(
            (user) => user.id !== socket.id
          );
          socket.emit("all users", usersInThisRoom);
          socket.to(roomID).emit("user joined", {
            signal: null,
            callerID: socket.id,
            userName,
          });
        }
      );

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

      socket.on(
        "returning signal",
        (payload: { callerID: string; signal: any }) => {
          io.to(payload.callerID).emit("receiving returned signal", {
            signal: payload.signal,
            id: socket.id,
          });
        }
      );

      socket.on("disconnect", () => {
        Object.keys(rooms).forEach((roomID) => {
          rooms[roomID] = rooms[roomID].filter((user) => user.id !== socket.id);
          if (rooms[roomID].length === 0) {
            delete rooms[roomID];
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
