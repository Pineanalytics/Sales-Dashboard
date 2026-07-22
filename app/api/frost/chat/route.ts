import { NextRequest, NextResponse } from "next/server";
import { runFrostChat, type FrostMessage } from "@/lib/frost/agent";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 20;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { messages?: FrostMessage[] };
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

  try {
    const reply = await runFrostChat(messages, session.user.allowedPages, session.user.role === "ADMIN");
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Frost chat failed", err);
    return NextResponse.json({ error: "Frost couldn't answer that — try again in a moment." }, { status: 500 });
  }
}
