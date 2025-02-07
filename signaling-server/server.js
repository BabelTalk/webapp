require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const xss = require("xss");

const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 1e6, // 1 MB max message size
  pingTimeout: 20000,
  pingInterval: 25000,
});

// MongoDB connection
const mongoClient = new MongoClient(process.env.DATABASE_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 50,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});
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

// Rate limiting for socket connections
const socketRateLimiter = new Map();
const RATE_LIMIT = {
  messages: { count: 50, timeWindow: 60000 }, // 50 messages per minute
  signals: { count: 100, timeWindow: 60000 }, // 100 signals per minute
  connections: { count: 10, timeWindow: 60000 }, // 10 connections per minute
};

function checkRateLimit(socketId, type) {
  if (!socketRateLimiter.has(socketId)) {
    socketRateLimiter.set(socketId, {
      messages: { count: 0, lastReset: Date.now() },
      signals: { count: 0, lastReset: Date.now() },
      connections: { count: 0, lastReset: Date.now() },
    });
  }

  const limits = socketRateLimiter.get(socketId);
  const now = Date.now();

  if (now - limits[type].lastReset > RATE_LIMIT[type].timeWindow) {
    limits[type].count = 0;
    limits[type].lastReset = now;
  }

  limits[type].count++;
  return limits[type].count <= RATE_LIMIT[type].count;
}

// Input validation functions
function validateRoomId(roomId) {
  return (
    typeof roomId === "string" &&
    roomId.length >= 6 &&
    roomId.length <= 50 &&
    /^[a-zA-Z0-9-_]+$/.test(roomId)
  );
}

function validateUserName(userName) {
  return (
    typeof userName === "string" &&
    userName.length >= 1 &&
    userName.length <= 50 &&
    /^[a-zA-Z0-9-_ ]+$/.test(userName)
  );
}

function sanitizeMessage(content) {
  return xss(content, {
    whiteList: {}, // Disable all HTML tags
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
  });
}

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  if (!checkRateLimit(socket.id, "connections")) {
    socket.emit("error", { message: "Too many connection attempts" });
    socket.disconnect(true);
    return;
  }

  // Handle chat messages with rate limiting and validation
  socket.on(
    "send message",
    async ({ roomID, content, userName, replyTo, mentions }) => {
      try {
        if (!checkRateLimit(socket.id, "messages")) {
          socket.emit("error", { message: "Message rate limit exceeded" });
          return;
        }

        if (!validateRoomId(roomID) || !validateUserName(userName)) {
          socket.emit("error", { message: "Invalid input parameters" });
          return;
        }

        const sanitizedContent = sanitizeMessage(content);
        const message = {
          roomId: roomID,
          content: sanitizedContent,
          userName,
          timestamp: new Date(),
          replyTo,
          reactions: [],
          mentions: mentions?.map((m) => sanitizeMessage(m)),
        };

        const result = await db.collection("messages").insertOne(message);
        message.id = result.insertedId;

        io.to(roomID).emit("receive message", message);
      } catch (error) {
        console.error("Error saving message:", error);
        socket.emit("error", { message: "Failed to save message" });
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
    if (!checkRateLimit(socket.id, "connections")) {
      socket.emit("error", { message: "Room join rate limit exceeded" });
      return;
    }

    if (!validateRoomId(roomID) || !validateUserName(userName)) {
      socket.emit("error", { message: "Invalid room ID or username" });
      return;
    }

    // Maximum room size check
    if (rooms[roomID] && rooms[roomID].length >= 50) {
      socket.emit("error", { message: "Room is full" });
      return;
    }

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
    if (!checkRateLimit(socket.id, "signals")) {
      socket.emit("error", { message: "Signal rate limit exceeded" });
      return;
    }

    if (
      !validateRoomId(payload.roomID) ||
      !validateUserName(payload.userName)
    ) {
      socket.emit("error", { message: "Invalid signal parameters" });
      return;
    }

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
    socketRateLimiter.delete(socket.id);
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});
