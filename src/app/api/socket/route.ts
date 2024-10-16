import { Server as NetServer } from "http";
import { NextApiRequest } from "next";
import { Server as ServerIO } from "socket.io";
import { NextApiResponseServerIO } from "@/types/next";

export const config = {
  api: {
    bodyParser: false,
  },
};

const users: { [key: string]: string[] } = {};

const ioHandler = (req: NextApiRequest, res: NextApiResponseServerIO) => {
  if (!res.socket) {
    res.status(500).json({ error: "Socket not found on response object" });
    return;
  }

  if (!res.socket.server) {
    res.status(500).json({ error: "Server not found on socket object" });
    return;
  }

  if (!res.socket.server.io) {
    const httpServer: NetServer = res.socket.server as any;
    const io = new ServerIO(httpServer, {
      path: "/api/socket",
    });

    io.on("connection", (socket) => {
      socket.on("join room", (roomID: string) => {
        if (users[roomID]) {
          users[roomID].push(socket.id);
        } else {
          users[roomID] = [socket.id];
        }
        const usersInThisRoom = users[roomID].filter((id) => id !== socket.id);
        socket.emit("all users", usersInThisRoom);
        socket
          .to(roomID)
          .emit("user joined", { signal: null, callerID: socket.id });
      });

      socket.on(
        "sending signal",
        (payload: { userToSignal: string; callerID: string; signal: any }) => {
          io.to(payload.userToSignal).emit("user joined", {
            signal: payload.signal,
            callerID: payload.callerID,
          });
        }
      );

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

    res.socket.server.io = io;
  }
  res.end();
};

export { ioHandler as GET, ioHandler as POST };
