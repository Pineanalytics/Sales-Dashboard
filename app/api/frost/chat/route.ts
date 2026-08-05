import { NextRequest, NextResponse } from "next/server";
import { runFrostChat, type FrostMessage } from "@/lib/frost/agent";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 20;

/** Restores the signed-in user's most recent Frost conversation (if any) so
 *  FrostChat.tsx can rehydrate history on mount instead of always starting
 *  empty (Phase 3 of the Frost expansion — see lib/frost/agent.ts). */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const conversation = await prisma.frostConversation.findFirst({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) {
    return NextResponse.json({ conversationId: null, messages: [] });
  }

  const messages = await prisma.frostConversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  return NextResponse.json({ conversationId: conversation.id, messages });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { messages?: FrostMessage[]; conversationId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a \"messages\" array." }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "\"messages\" must be a non-empty array." }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: `Conversation is too long (max ${MAX_MESSAGES} messages) — start a new chat.` }, { status: 400 });
  }

  // The client always resends the full running transcript with exactly one new
  // user message appended (see FrostChat.tsx's send()) — only that last entry
  // needs persisting; everything before it was already saved on a prior turn.
  const newUserMessage = messages[messages.length - 1];
  if (newUserMessage.role !== "user") {
    return NextResponse.json({ error: "The last message must be from the user." }, { status: 400 });
  }

  let conversationId = body.conversationId ?? null;
  if (conversationId) {
    const existing = await prisma.frostConversation.findUnique({ where: { id: conversationId } });
    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Unknown conversation." }, { status: 403 });
    }
  } else {
    const created = await prisma.frostConversation.create({ data: { userId: session.user.id } });
    conversationId = created.id;
  }

  await prisma.frostConversationMessage.create({
    data: { conversationId, role: newUserMessage.role, content: newUserMessage.content },
  });

  try {
    const isAdmin = session.user.role === "ADMIN";
    const teamLeaderId = session.user.role === "TEAM_LEADER" ? session.user.teamLeaderId : null;
    const allowedPrincipals = session.user.role === "VIEWER" ? session.user.allowedPrincipals : [];
    const result = await runFrostChat(messages, session.user.allowedPages, isAdmin, teamLeaderId, allowedPrincipals);

    await Promise.all([
      prisma.frostConversationMessage.create({ data: { conversationId, role: "assistant", content: result.text } }),
      prisma.frostConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    ]);

    return NextResponse.json({ reply: result.text, metrics: result.metrics, followUps: result.followUps, conversationId });
  } catch (err) {
    console.error("Frost chat failed", err);
    return NextResponse.json({ error: "Frost couldn't answer that — try again in a moment.", conversationId }, { status: 500 });
  }
}
