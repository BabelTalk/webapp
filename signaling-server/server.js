require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
  },
});

// Store active rooms and their participants
const rooms = {};

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("join room", ({ roomID, userName }) => {
    console.log(`User ${userName} joining room ${roomID}`);

    // Add user to room
    if (rooms[roomID]) {
      rooms[roomID].push({ id: socket.id, userName });
    } else {
      rooms[roomID] = [{ id: socket.id, userName }];
    }

    // Join socket room
    socket.join(roomID);

    // Get other users in room
    const usersInThisRoom = rooms[roomID].filter(
      (user) => user.id !== socket.id
    );

    // Send existing users to the new participant
    socket.emit("all users", usersInThisRoom);

    // Notify others about new user
    socket.to(roomID).emit("user joined", {
      signal: null,
      callerID: socket.id,
      userName,
    });
  });

  socket.on("sending signal", (payload) => {
    console.log(`Signal from ${socket.id} to ${payload.userToSignal}`);
    io.to(payload.userToSignal).emit("user joined", {
      signal: payload.signal,
      callerID: payload.callerID,
    });
  });

  socket.on("returning signal", (payload) => {
    io.to(payload.callerID).emit("receiving returned signal", {
      signal: payload.signal,
      id: socket.id,
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // Remove user from all rooms they were in
    Object.keys(rooms).forEach((roomID) => {
      rooms[roomID] = rooms[roomID]?.filter((user) => user.id !== socket.id);
      if (rooms[roomID]?.length === 0) {
        delete rooms[roomID];
      } else {
        socket.to(roomID).emit("user left", socket.id);
      }
    });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
