import Anthropic from "@anthropic-ai/sdk";
import { toolsForUser } from "./tools";
import { FROST_SEMANTIC_NOTES } from "./semantics";

const MODEL = "claude-sonnet-5";

export interface FrostMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FrostReply {
  text: string;
  metrics?: { label: string; value: string }[];
  followUps?: string[];
}

const SYSTEM_PROMPT =
  "You are Frost, the sales-operations assistant for Pinefrost Limited, a Kenyan FMCG distributor. " +
  "Answer questions about sales, targets, coverage, JP adherence, active outlets, and profitability using " +
  "only the tools provided — never estimate or invent a figure. If a tool returns no data or an error, say " +
  "so plainly rather than guessing. Keep answers short and direct, in plain business language. State the " +
  "period and principal scope you used when it isn't obvious from the question. However short, every reply " +
  "must be a complete thought — never trail off or stop mid-sentence; if a full answer would run long, " +
  "summarize rather than let it get cut short. Write in plain prose, not markdown — no **bold**, headers, or " +
  "bullet-point asterisks; the chat window renders raw text, so that punctuation would show up literally. Use " +
  "line breaks and plain dashes for a list instead.\n\n" +
  "For a 'why' question (e.g. why sales are down, why we're behind target), don't answer from a single " +
  "number — drill down: check the overall gap (get_sales_vs_target / compare_periods), then break it down " +
  "by principal, then check rep performance (get_tl_ranking, get_coverage_by_rep) and customer movement " +
  "(get_active_outlets_summary) before concluding. Clearly separate what the data shows (fact) from your " +
  "read on why (interpretation) and what you'd suggest doing about it (recommendation) — don't present the " +
  "interpretation as if it were itself a confirmed fact.\n\n" +
  "You have a web_search tool. It is a different trust tier from every other tool you have: every other tool " +
  "reads Pinefrost's own real, computed data, so you never invent or adjust its numbers — web_search instead " +
  "returns whatever the open internet currently says, which can be outdated, wrong, or about the wrong " +
  "company entirely. Only reach for it when the question is genuinely about something outside this app's data " +
  "— a competitor's activity, market/industry news, general FMCG knowledge — and never to answer a question " +
  "about Pinefrost's own sales, targets, coverage, reps, or customers; that data always comes from the tools " +
  "above, never from a search result, even if a search result seems to mention Pinefrost. When you do use it, " +
  "open that part of your answer with a plain-language flag such as \"From a web search (not our own data, " +
  "unverified):\" before the finding, and name the source. If a user asks you to compare a Pinefrost figure " +
  "against a competitor's, get the Pinefrost figure from the tools above and clearly mark the competitor side " +
  "as unverified web research, side by side — never blend the two into one number.\n\n" +
  FROST_SEMANTIC_NOTES +
  "\n\n" +
  "When your answer centers on a small number of concrete figures worth highlighting (e.g. a revenue vs " +
  "target comparison, a ranking, a gap breakdown), end your reply with a single fenced JSON block, exactly " +
  "in this form, after a blank line:\n" +
  "```json\n" +
  '{"metrics": [{"label": "Revenue", "value": "KES 8.5M"}], "followUps": ["Why are we behind target?"]}\n' +
  "```\n" +
  "metrics: at most 4 of the most important figures from your answer, each a short label and a pre-" +
  "formatted value string (already using the same units/formatting as your prose). followUps: at most 3 " +
  "short, natural next questions the user could tap to continue this conversation, phrased as things they " +
  "would ask you, not as instructions to you. Omit the block entirely for simple answers with no standout " +
  "figures (e.g. yes/no, 'no data available', clarifying questions) — don't force it. The block must be the " +
  "very last thing in your reply, and your prose above it should already read as a complete answer without " +
  "it.";

/** Drives one turn of the Frost tool-use agent — the SDK's Tool Runner handles
 *  the call → tool-execute → feed-result-back loop, so this just supplies the
 *  toolset scoped to the requesting user's page access and (for a
 *  TEAM_LEADER) their own team (see tools.ts), then splits the final text
 *  into prose plus an optional structured metrics/followUps block (see
 *  parseFrostReply). No conversation state is persisted server-side; the
 *  client resends the running transcript each turn (see FrostChat.tsx) —
 *  using only the prose `content`, never the structured block, so a later
 *  turn's context doesn't grow with rendering metadata. */
export async function runFrostChat(
  messages: FrostMessage[],
  allowedPages: readonly string[],
  isAdmin: boolean,
  teamLeaderId: string | null
): Promise<FrostReply> {
  const client = new Anthropic();
  const tools = await toolsForUser(allowedPages, isAdmin, teamLeaderId);

  const finalMessage = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const textBlock = finalMessage.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "I couldn't come up with an answer for that.";
  return parseFrostReply(raw);
}

/** Pulls a trailing ```json ...``` block (metrics/followUps) off Claude's raw
 *  reply. Falls back to plain text on anything malformed or absent — the
 *  structured block is a rendering nicety, never load-bearing for the answer
 *  itself. */
export function parseFrostReply(raw: string): FrostReply {
  const match = raw.match(/```json\s*([\s\S]*?)\s*```\s*$/);
  if (!match) return { text: raw.trim() };

  const text = raw.slice(0, match.index).trim();
  try {
    const parsed = JSON.parse(match[1]);
    const metrics = Array.isArray(parsed.metrics)
      ? parsed.metrics
          .filter((m: unknown): m is { label: string; value: string } => typeof (m as { label?: unknown })?.label === "string" && typeof (m as { value?: unknown })?.value === "string")
          .slice(0, 4)
      : undefined;
    const followUps = Array.isArray(parsed.followUps) ? parsed.followUps.filter((f: unknown): f is string => typeof f === "string").slice(0, 3) : undefined;
    return { text: text || raw.trim(), metrics, followUps };
  } catch {
    return { text: raw.trim() };
  }
}
