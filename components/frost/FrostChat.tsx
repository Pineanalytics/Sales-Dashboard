"use client";

import { useRef, useState } from "react";
import { Send20Regular, Sparkle20Regular } from "@fluentui/react-icons";
import { SectionCard } from "@/components/ui/KpiGrid";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type { FrostMessage } from "@/lib/frost/agent";

const SUGGESTIONS = [
  "How is this month's sales tracking against target?",
  "Which reps have the best coverage this month?",
  "Are any of our data syncs stale right now?",
];

/** Local rendering shape — extends the plain {role, content} wire format with
 *  the optional structured block Frost's API returns for the most recent
 *  assistant turn. Only `role`/`content` ever go back to the server (see
 *  send()); metrics/followUps are display-only, never resent as context. */
interface DisplayMessage extends FrostMessage {
  metrics?: { label: string; value: string }[];
  followUps?: string[];
}

/** Client-only conversation state — no chat history is persisted server-side
 *  (see lib/frost/agent.ts). Refreshing the page starts a new conversation. */
export function FrostChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const next: DisplayMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/frost/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Frost couldn't answer that.");
      setMessages([...next, { role: "assistant", content: body.reply, metrics: body.metrics, followUps: body.followUps }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Frost couldn't answer that.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SectionCard title="Frost" action={<span className="text-xs text-muted">Ask about sales, coverage, or profitability</span>}>
      <div className="flex flex-col gap-3">
        <div className="flex min-h-[280px] max-h-[480px] flex-col gap-3 overflow-y-auto rounded-lg bg-background-elevated/50 p-3">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
              <Sparkle20Regular className="h-8 w-8 text-primary-blue" />
              <p className="text-sm text-muted">Ask Frost a question about your data.</p>
              <div className="flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-strong transition-colors hover:border-primary-blue hover:text-primary-blue"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const isLastAssistant = m.role === "assistant" && i === messages.length - 1;
              return (
                <div key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white"
                        : "bg-surface text-foreground shadow-[0_1px_3px_rgba(10,31,82,0.06)]"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.metrics && m.metrics.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {m.metrics.map((metric, mi) => (
                        <div key={mi} className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs">
                          <span className="text-muted">{metric.label}: </span>
                          <span className="font-semibold text-foreground">{metric.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {isLastAssistant && m.followUps && m.followUps.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {m.followUps.map((f, fi) => (
                        <button
                          key={fi}
                          onClick={() => send(f)}
                          disabled={sending}
                          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-strong transition-colors hover:border-primary-blue hover:text-primary-blue disabled:opacity-60"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          {sending ? (
            <div className="flex justify-start">
              <div className="rounded-xl bg-surface px-3.5 py-2 shadow-[0_1px_3px_rgba(10,31,82,0.06)]">
                <Spinner className="h-3.5 w-3.5" />
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? <p className="text-xs text-brand-orange">{error}</p> : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Frost a question…"
            disabled={sending}
            className="flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue disabled:opacity-60"
          />
          <Button type="submit" icon={<Send20Regular className="h-4 w-4" />} disabled={sending || !input.trim()}>
            Send
          </Button>
        </form>
      </div>
    </SectionCard>
  );
}
