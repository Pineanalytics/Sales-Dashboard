import Anthropic from "@anthropic-ai/sdk";
import { toolsForUser } from "./tools";
import { FROST_SEMANTIC_NOTES } from "./semantics";

const MODEL = "claude-sonnet-5";

export interface FrostMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT =
  "You are Frost, the sales-operations assistant for Pinefrost Limited, a Kenyan FMCG distributor. " +
  "Answer questions about sales, targets, coverage, JP adherence, active outlets, and profitability using " +
  "only the tools provided — never estimate or invent a figure. If a tool returns no data or an error, say " +
  "so plainly rather than guessing. Keep answers short and direct, in plain business language. State the " +
  "period and principal scope you used when it isn't obvious from the question.\n\n" +
  "For a 'why' question (e.g. why sales are down, why we're behind target), don't answer from a single " +
  "number — drill down: check the overall gap (get_sales_vs_target / compare_periods), then break it down " +
  "by principal, then check rep performance (get_tl_ranking, get_coverage_by_rep) and customer movement " +
  "(get_active_outlets_summary) before concluding. Clearly separate what the data shows (fact) from your " +
  "read on why (interpretation) and what you'd suggest doing about it (recommendation) — don't present the " +
  "interpretation as if it were itself a confirmed fact.\n\n" +
  FROST_SEMANTIC_NOTES;

/** Drives one turn of the Frost tool-use agent — the SDK's Tool Runner handles
 *  the call → tool-execute → feed-result-back loop, so this just supplies the
 *  toolset scoped to the requesting user's page access and (for a
 *  TEAM_LEADER) their own team (see tools.ts) and returns the final text. No
 *  conversation state is persisted server-side; the client resends the
 *  running transcript each turn (see FrostChat.tsx). */
export async function runFrostChat(
  messages: FrostMessage[],
  allowedPages: readonly string[],
  isAdmin: boolean,
  teamLeaderId: string | null
): Promise<string> {
  const client = new Anthropic();
  const tools = await toolsForUser(allowedPages, isAdmin, teamLeaderId);

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
