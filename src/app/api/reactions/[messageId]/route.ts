import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function DELETE(
  req: Request,
  { params }: { params: { messageId: string } }
) {
  try {
    const body = await req.json();
    const { userName, emoji } = body;
    const { messageId } = params;

    await prisma.reaction.deleteMany({
      where: {
        messageId,
        userName,
        emoji,
      },
    });

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error("Error deleting reaction:", error);
    return NextResponse.json(
      { error: "Failed to delete reaction" },
      { status: 500 }
    );
  }
}
