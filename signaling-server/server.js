require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
  },
});

// MongoDB connection
const mongoClient = new MongoClient(process.env.DATABASE_URL);
let db;

const roomHosts = new Map(); // In-memory store of room hosts

async function connectToMongo() {
  try {
    await mongoClient.connect();
    db = mongoClient.db("babeltalk");
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

connectToMongo();

// Store active rooms and their participants
const rooms = {};

// Add this function to check if a room exists and get its host
async function getRoomHost(roomId) {
  try {
    const message = await db.collection("messages").findOne({ roomId });
    if (message) {
      return message.hostId; // Return the hostId of the first message in the room
    }
    return null;
  } catch (error) {
    console.error("Error getting room host:", error);
    return null;
  }
}

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Handle chat messages
  socket.on(
    "send message",
    async ({ roomID, content, userName, replyTo, mentions }) => {
      try {
        const message = {
          roomId: roomID,
          content,
          userName,
          timestamp: new Date(),
          replyTo,
          reactions: [],
          mentions,
        };

        // Save to MongoDB
        const result = await db.collection("messages").insertOne(message);
        message.id = result.insertedId;

        // Broadcast to room
        io.to(roomID).emit("receive message", message);
      } catch (error) {
        console.error("Error saving message:", error);
      }
    }
  );

  // Handle reactions
  socket.on("add reaction", async ({ messageId, reaction }) => {
    try {
      await db
        .collection("messages")
        .updateOne(
          { _id: new ObjectId(messageId) },
          { $push: { reactions: reaction } }
        );

      const message = await db
        .collection("messages")
        .findOne({ _id: new ObjectId(messageId) });

      if (message) {
        io.to(message.roomId).emit("message reaction", {
          messageId,
          reaction,
        });
      }
    } catch (error) {
      console.error("Error adding reaction:", error);
    }
  });

  socket.on("join room", async ({ roomID, userName, isMuted, isCameraOff }) => {
    console.log(`User ${userName} joining room ${roomID}`);

    let isHost = false;

    // Check if room exists in memory
    if (!rooms[roomID]) {
      rooms[roomID] = [];
      // Check if room exists in database
      const existingHostId = await getRoomHost(roomID);
      if (!existingHostId) {
        // This is a new room, make this user the host
        isHost = true;
        roomHosts.set(roomID, socket.id);
      } else {
        // Room exists in database, check if the host is still connected
        const hostSocket = io.sockets.sockets.get(existingHostId);
        if (!hostSocket) {
          // Original host is disconnected, make this user the host
          isHost = true;
          roomHosts.set(roomID, socket.id);
        }
      }
    } else {
      // Room exists in memory, check if this socket is the host
      isHost = roomHosts.get(roomID) === socket.id;
    }

    // Add user to room
    rooms[roomID].push({
      id: socket.id,
      userName,
      isMuted,
      isCameraOff,
      isHost,
    });

    // Join socket room
    socket.join(roomID);

    // Get other users in room
    const usersInThisRoom = rooms[roomID].filter(
      (user) => user.id !== socket.id
    );

    // Send existing users to the new participant
    socket.emit("all users", usersInThisRoom);

    // Load and send chat history
    try {
      const messages = await db
        .collection("messages")
        .find({ roomId: roomID })
        .sort({ timestamp: 1 })
        .toArray();

      socket.emit("chat history", messages);
    } catch (error) {
      console.error("Error loading chat history:", error);
    }

    // Notify others about new user
    socket.to(roomID).emit("user joined", {
      signal: null,
      callerID: socket.id,
      userName,
      isMuted,
      isCameraOff,
      isHost,
    });
  });

  socket.on("sending signal", (payload) => {
    io.to(payload.userToSignal).emit("user joined", {
      signal: payload.signal,
      callerID: payload.callerID,
      userName: payload.userName,
      isMuted: false,
      isCameraOff: false,
    });
  });

  socket.on("returning signal", (payload) => {
    io.to(payload.callerID).emit("receiving returned signal", {
      signal: payload.signal,
      id: socket.id,
    });
  });

  // Handle mute status changes
  socket.on("mute_status", ({ isMuted }) => {
    Object.keys(rooms).forEach((roomID) => {
      const userIndex = rooms[roomID].findIndex(
        (user) => user.id === socket.id
      );
      if (userIndex !== -1) {
        rooms[roomID][userIndex].isMuted = isMuted;
        socket.to(roomID).emit("peer_mute_status", {
          peerId: socket.id,
          isMuted,
        });
      }
    });
  });

  // Handle camera status changes
  socket.on("camera_status", ({ isCameraOff }) => {
    Object.keys(rooms).forEach((roomID) => {
      const userIndex = rooms[roomID].findIndex(
        (user) => user.id === socket.id
      );
      if (userIndex !== -1) {
        rooms[roomID][userIndex].isCameraOff = isCameraOff;
        socket.to(roomID).emit("peer_camera_status", {
          peerId: socket.id,
          isCameraOff,
        });
      }
    });
  });

  // Handle message delivery confirmation
  socket.on("message_delivered", ({ messageId, userName }) => {
    // Find the room this user is in
    const roomID = Object.keys(rooms).find((roomID) =>
      rooms[roomID].some((user) => user.id === socket.id)
    );

    if (roomID) {
      // Notify the message sender
      socket.to(roomID).emit("message_delivered", { messageId, userName });
    }
  });

  // Handle chat clearing by host
  socket.on("chat_cleared", ({ roomId }) => {
    const user = Object.values(rooms)
      .flat()
      .find((user) => user.id === socket.id);

    if (user?.isHost) {
      socket.to(roomId).emit("chat_cleared");
    }
  });

  // Handle host actions
  socket.on("host_action", async ({ roomId, action, targetId }) => {
    const isHost = roomHosts.get(roomId) === socket.id;
    if (!isHost) {
      console.log("Unauthorized host action attempt:", socket.id);
      return;
    }

    switch (action) {
      case "mute_user":
        socket.to(targetId).emit("force_mute");
        socket.to(roomId).emit("user_muted", { userId: targetId });
        break;
      case "disable_video":
        socket.to(targetId).emit("force_video_off");
        socket.to(roomId).emit("user_video_disabled", { userId: targetId });
        break;
      case "clear_chat":
        try {
          await db.collection("messages").deleteMany({ roomId });
          io.to(roomId).emit("chat_cleared");
        } catch (error) {
          console.error("Error clearing chat:", error);
        }
        break;
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    // Check if this socket was a host
    for (const [roomId, hostId] of roomHosts.entries()) {
      if (hostId === socket.id) {
        // Remove host status
        roomHosts.delete(roomId);

        // If there are other users in the room, assign host to the next user
        if (rooms[roomId]?.length > 1) {
          const nextHost = rooms[roomId].find((user) => user.id !== socket.id);
          if (nextHost) {
            roomHosts.set(roomId, nextHost.id);
            io.to(roomId).emit("host_changed", { newHostId: nextHost.id });
          }
        }
      }
    }

    // Remove from rooms
    Object.keys(rooms).forEach((roomID) => {
      rooms[roomID] = rooms[roomID]?.filter((user) => user.id !== socket.id);
      if (rooms[roomID]?.length === 0) {
        delete rooms[roomID];
        roomHosts.delete(roomID);
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
