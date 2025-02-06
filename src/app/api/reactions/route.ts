import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messageId, emoji, userName } = body;

    const reaction = await prisma.reaction.create({
      data: {
        messageId,
        emoji,
        userName,
      },
    });

    return NextResponse.json(reaction);
  } catch (error) {
    console.error("Error creating reaction:", error);
    return NextResponse.json(
      { error: "Failed to create reaction" },
      { status: 500 }
    );
  }
}
