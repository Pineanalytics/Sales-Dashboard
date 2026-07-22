import Anthropic from "@anthropic-ai/sdk";
import { toolsForUser } from "./tools";

const MODEL = "claude-sonnet-5";

export interface FrostMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT =
  "You are Frost, the sales-operations assistant for Pinefrost Limited, a Kenyan FMCG distributor. " +
  "Answer questions about sales, coverage, and profitability using only the tools provided — never " +
  "estimate or invent a figure. If a tool returns no data or an error, say so plainly rather than " +
  "guessing. Keep answers short and direct, in plain business language. State the period and " +
  "principal scope you used when it isn't obvious from the question.";

/** Drives one turn of the Frost tool-use agent — the SDK's Tool Runner handles
 *  the call → tool-execute → feed-result-back loop, so this just supplies the
 *  toolset scoped to the requesting user's page access (see tools.ts) and
 *  returns the final text. No conversation state is persisted server-side;
 *  the client resends the running transcript each turn (see FrostChat.tsx). */
export async function runFrostChat(messages: FrostMessage[], allowedPages: readonly string[], isAdmin: boolean): Promise<string> {
  const client = new Anthropic();
  const tools = toolsForUser(allowedPages, isAdmin);

  const finalMessage = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const textBlock = finalMessage.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "I couldn't come up with an answer for that.";
}
