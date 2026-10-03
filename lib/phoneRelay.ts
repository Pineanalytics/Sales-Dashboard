// Relay between an Android "phone app" (a PWA) and the Windows PC that runs the EDGE365
// report automation, so a login / control actions can be done from a phone without the
// PC being reachable from the internet: the phone talks to this app, and the PC's
// agents only ever make OUTBOUND calls here (polling /api/phone-relay/agent/sync).
//
// Security model:
//  - Two secrets, both env-provided on the VPS (/opt/pinefrost/.env): PHONE_RELAY_KEY
//    (the phone) and PHONE_RELAY_AGENT_KEY (the PC agents). Unset = relay disabled (503).
//  - The login password and MFA code are NEVER readable here: the phone encrypts them
//    (RSA-OAEP) to a public key the PC publishes, and the phone pins that key's
//    fingerprint from a setup link generated on the PC, so even a compromised VPS can't
//    swap in its own key unnoticed. This module only ever holds ciphertext, briefly, in
//    memory (nothing is persisted to Postgres), with a short expiry.
//  - Wrong keys are rate-limited per client address; commands are rate-limited too.
//
// State is in-process memory behind a globalThis singleton (route bundles don't share
// module instances). Everything here is short-lived by design, so a restart simply
// drops pending commands - the phone shows the agents as offline until they re-sync.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export type RelayTarget = "automation" | "panel";
export type CommandType = "login" | "mfa" | "start" | "stop" | "backfill" | "push-uploads";

export const COMMAND_TARGET: Record<CommandType, RelayTarget> = {
  login: "automation",
  mfa: "automation",
  start: "panel",
  stop: "panel",
  backfill: "panel",
  "push-uploads": "panel",
};
const ENCRYPTED_TYPES: CommandType[] = ["login", "mfa"];

export const COMMAND_TTL_MS = 5 * 60_000; // an unclaimed command is dropped after this
export const CLAIMED_TTL_MS = 2 * 60_000; // a claimed command with no result reported is dropped after this
export const AGENT_ONLINE_MS = 45_000;
const MAX_PENDING = 20;
const MAX_RESULTS = 10;
const MAX_CIPHER_CHARS = 1024; // RSA-2048 ciphertext is 344 base64 chars; allow headroom for a bigger key
const MAX_STATUS_BYTES = 8_192;
const KEY_FAIL_WINDOW_MS = 15 * 60_000;
const KEY_FAIL_LIMIT = 5;
const COMMAND_RATE_WINDOW_MS = 60_000;
const COMMAND_RATE_LIMIT = 10;

export interface RelayCommand {
  id: string;
  type: CommandType;
  target: RelayTarget;
  cipher?: string;
  date?: string;
  createdAt: number;
  claimedAt?: number;
}
export interface RelayResult { id: string; type: CommandType; ok: boolean; message: string; at: number }
interface AgentInfo { status: unknown; at: number }
interface RelayState {
  publicKey: string | null;
  agents: Record<RelayTarget, AgentInfo | null>;
  commands: RelayCommand[];
  results: RelayResult[];
  keyFailures: Map<string, number[]>;
  commandTimes: Map<string, number[]>;
}

const g = globalThis as unknown as { __phoneRelayState?: RelayState };
export function getRelayState(): RelayState {
  if (!g.__phoneRelayState) {
    g.__phoneRelayState = { publicKey: null, agents: { automation: null, panel: null }, commands: [], results: [], keyFailures: new Map(), commandTimes: new Map() };
  }
  return g.__phoneRelayState;
}
export function resetRelayStateForTests(): void { g.__phoneRelayState = undefined; }

const sha = (value: string) => createHash("sha256").update(value).digest();
function keysMatch(supplied: string | null, expected: string | undefined): boolean {
  if (!supplied || !expected) return false;
  return timingSafeEqual(sha(supplied), sha(expected));
}

export type KeyKind = "phone" | "agent";
export type KeyCheck = "ok" | "unconfigured" | "locked" | "denied";
export function checkKey(kind: KeyKind, supplied: string | null, client: string, now: number, env: NodeJS.ProcessEnv = process.env): KeyCheck {
  const expected = kind === "phone" ? env.PHONE_RELAY_KEY : env.PHONE_RELAY_AGENT_KEY;
  if (!expected) return "unconfigured";
  const state = getRelayState();
  const recent = (state.keyFailures.get(client) ?? []).filter((t) => now - t < KEY_FAIL_WINDOW_MS);
  state.keyFailures.set(client, recent);
  if (recent.length >= KEY_FAIL_LIMIT) return "locked";
  if (keysMatch(supplied, expected)) return "ok";
  recent.push(now);
  return "denied";
}

export interface EnqueueInput { type?: unknown; cipher?: unknown; date?: unknown }
export type EnqueueResult = { ok: true; id: string } | { ok: false; error: string; status: number };

function pruneCommands(state: RelayState, now: number) {
  state.commands = state.commands.filter((c) => (c.claimedAt ? now - c.claimedAt < CLAIMED_TTL_MS : now - c.createdAt < COMMAND_TTL_MS));
}

export function enqueueCommand(input: EnqueueInput, client: string, now: number): EnqueueResult {
  const state = getRelayState();
  const times = (state.commandTimes.get(client) ?? []).filter((t) => now - t < COMMAND_RATE_WINDOW_MS);
  if (times.length >= COMMAND_RATE_LIMIT) return { ok: false, error: "Too many requests - slow down.", status: 429 };
  const type = input.type as CommandType;
  if (typeof input.type !== "string" || !(type in COMMAND_TARGET)) return { ok: false, error: "Unknown command.", status: 400 };
  const command: RelayCommand = { id: randomUUID(), type, target: COMMAND_TARGET[type], createdAt: now };
  if (ENCRYPTED_TYPES.includes(type)) {
    if (typeof input.cipher !== "string" || !/^[A-Za-z0-9+/=]+$/.test(input.cipher) || input.cipher.length > MAX_CIPHER_CHARS) {
      return { ok: false, error: "Missing or invalid encrypted payload.", status: 400 };
    }
    command.cipher = input.cipher;
  }
  if (type === "backfill") {
    if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) {
      return { ok: false, error: "Backfill needs a date (YYYY-MM-DD).", status: 400 };
    }
    command.date = input.date;
  }
  pruneCommands(state, now);
  // The latest login/MFA attempt supersedes an older unclaimed one of the same kind.
  if (ENCRYPTED_TYPES.includes(type)) state.commands = state.commands.filter((c) => !(c.type === type && !c.claimedAt));
  if (state.commands.length >= MAX_PENDING) return { ok: false, error: "Too many pending commands.", status: 429 };
  times.push(now);
  state.commandTimes.set(client, times);
  state.commands.push(command);
  return { ok: true, id: command.id };
}

export interface AgentSyncBody { status?: unknown; publicKey?: unknown; results?: unknown }
export type SyncResult = { ok: true; commands: RelayCommand[] } | { ok: false; error: string; status: number };

export function syncAgent(target: RelayTarget, body: AgentSyncBody, now: number): SyncResult {
  const state = getRelayState();
  if (body.status !== undefined) {
    const size = Buffer.byteLength(JSON.stringify(body.status) ?? "");
    if (size > MAX_STATUS_BYTES) return { ok: false, error: "Status too large.", status: 413 };
    state.agents[target] = { status: body.status, at: now };
  } else if (state.agents[target]) {
    state.agents[target] = { status: state.agents[target]!.status, at: now };
  } else {
    state.agents[target] = { status: null, at: now };
  }
  if (target === "automation" && typeof body.publicKey === "string" && body.publicKey.length > 0 && body.publicKey.length <= 1024 && /^[A-Za-z0-9+/=]+$/.test(body.publicKey)) {
    state.publicKey = body.publicKey;
  }
  if (Array.isArray(body.results)) {
    for (const raw of body.results.slice(0, 20)) {
      const r = raw as { id?: unknown; ok?: unknown; message?: unknown };
      const command = state.commands.find((c) => c.id === r.id && c.target === target);
      if (!command) continue;
      state.commands = state.commands.filter((c) => c.id !== command.id);
      state.results.unshift({ id: command.id, type: command.type, ok: r.ok === true, message: String(r.message ?? "").slice(0, 300), at: now });
    }
    state.results = state.results.slice(0, MAX_RESULTS);
  }
  pruneCommands(state, now);
  const mine = state.commands.filter((c) => c.target === target && !c.claimedAt);
  for (const c of mine) c.claimedAt = now;
  return { ok: true, commands: mine };
}

export function getPhoneView(now: number) {
  const state = getRelayState();
  pruneCommands(state, now);
  const agent = (target: RelayTarget) => {
    const a = state.agents[target];
    return a ? { status: a.status, at: a.at, online: now - a.at < AGENT_ONLINE_MS } : { status: null, at: 0, online: false };
  };
  return {
    publicKey: state.publicKey,
    agents: { automation: agent("automation"), panel: agent("panel") },
    pending: state.commands.length,
    results: state.results,
    serverTime: now,
  };
}

export function clientAddress(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
