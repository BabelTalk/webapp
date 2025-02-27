import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get("roomId");

    if (!roomId) {
      return NextResponse.json(
        { error: "Room ID is required" },
        { status: 400 }
      );
    }

    const messages = await prisma.message.findMany({
      where: {
        roomId,
      },
      include: {
        reactions: true,
        replyTo: {
          include: {
            reactions: true, // Include reactions on the replied message if needed
          },
        },
      },
      orderBy: {
        timestamp: "asc",
      },
    });
    

    return NextResponse.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roomId, content, userName, replyToId, mentions } = body;

    if (!roomId) {
      return NextResponse.json(
        { error: "Room ID is required" },
        { status: 400 }
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: "Message content is required" },
        { status: 400 }
      );
    }

    if (!userName) {
      return NextResponse.json(
        { error: "User name is required" },
        { status: 400 }
      );
    }

    const message = await prisma.message.create({
      data: {
        roomId,
        content,
        userName,
        replyToId,
        mentions: mentions || [],
      },
      include: {
        reactions: true,
        replyTo: true,
      },
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("Error creating message:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}

// Delete all messages in a room (host only)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get("roomId");
    const isHost = searchParams.get("isHost") === "true";

    if (!roomId || !isHost) {
      return NextResponse.json(
        { error: "Room ID and host status required" },
        { status: 400 }
      );
    }

    // Delete all reactions first due to foreign key constraints
    await prisma.reaction.deleteMany({
      where: {
        message: {
          roomId,
        },
      },
    });

    // Then delete all messages
    await prisma.message.deleteMany({
      where: {
        roomId,
      },
    });

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error("Error deleting messages:", error);
    return NextResponse.json(
      { error: "Failed to delete messages" },
      { status: 500 }
    );
  }
}
