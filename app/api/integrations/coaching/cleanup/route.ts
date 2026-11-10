import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeActor, runAsBridgeActor, type BridgeIdentity } from "@/lib/outletCleanup/access";
import * as disown from "@/app/api/outlet-cleanup/disown/route";
import * as filters from "@/app/api/outlet-cleanup/filters/route";
import * as open from "@/app/api/outlet-cleanup/open/route";
import * as outlet from "@/app/api/outlet-cleanup/outlet/route";
import * as progress from "@/app/api/outlet-cleanup/progress/route";
import * as queue from "@/app/api/outlet-cleanup/queue/route";
import * as review from "@/app/api/outlet-cleanup/review/route";
import * as routes from "@/app/api/outlet-cleanup/routes/route";
import * as summary from "@/app/api/outlet-cleanup/summary/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outlet Cleanup for the Coaching application (the phone app), server to server.
 *
 * The Coaching app's server has already signed the person in (its own login) and says who they are: a team leader or supervisor by the name this application spells
 * it, a sales rep by their user code. This route checks the shared key, resolves that person against the roster tables exactly as a signed-in user here would be
 * (`resolveBridgeActor`) and runs the SAME handlers the Outlet Cleanup page calls, as that person: same scope, same rules, same log. Nothing about the cleanup is
 * implemented twice. Contract: docs/coaching-outlet-cleanup-bridge.md.
 *
 * POST { identity: { role, name?, repCode?, email }, path, method: "GET" | "POST", query?: { ... }, body?: { ... } }
 */

type Handler = { GET?: (req: NextRequest) => Promise<Response> | Response; POST?: (req: NextRequest) => Promise<Response> | Response };

const HANDLERS: Record<string, Handler> = { disown, filters, open, outlet, progress, queue, review, routes, summary };

/** What a sales rep may do: look at the outlets they sell and save their own details, location and routes. Everything else belongs to team leaders and supervisors. */
const REP_OUTLET_ACTIONS = new Set(["save", "geo", "reps", "draft", "discardDraft", "final"]);

function hasValidKey(request: NextRequest) {
  const expected = process.env.COACHING_REFERENCE_SYNC_KEY;
  const provided = request.headers.get("x-coaching-reference-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const IDENTITY_ROLES = new Set(["TEAM_LEADER", "SUPERVISOR", "REP", "HOD", "DIRECTOR"]);

export async function POST(request: NextRequest) {
  if (!hasValidKey(request)) return NextResponse.json({ error: "Invalid coaching reference credentials." }, { status: 401 });
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const identity = input?.identity as Partial<BridgeIdentity> | undefined;
  const path = typeof input?.path === "string" ? input.path : "";
  const method = input?.method === "POST" ? "POST" : "GET";
  if (!input || !identity || !IDENTITY_ROLES.has(String(identity.role)) || typeof identity.email !== "string") return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  const handler = HANDLERS[path];
  if (!handler || !handler[method]) return NextResponse.json({ error: "Unknown outlet cleanup request." }, { status: 404 });

  const body = method === "POST" && input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : null;
  if (identity.role === "REP") {
    const allowed = path === "queue" || path === "filters" || (path === "outlet" && (method === "GET" || (body && REP_OUTLET_ACTIONS.has(String(body.action)))));
    if (!allowed) return NextResponse.json({ error: "A sales rep can update their own outlets; ask your team leader for this." }, { status: 403 });
  }

  const access = await resolveBridgeActor(identity as BridgeIdentity);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Sign in required." : "You are not on the Sales Dashboard roster for the outlet cleanup. Ask an admin to link your name." },
      { status: access.status },
    );
  }

  const query = new URLSearchParams();
  if (input.query && typeof input.query === "object") for (const [key, value] of Object.entries(input.query as Record<string, unknown>)) if (typeof value === "string" || typeof value === "number") query.set(key, String(value));
  const inner = new NextRequest(`http://coaching-bridge.local/api/outlet-cleanup/${path}${query.toString() ? `?${query.toString()}` : ""}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const response = await runAsBridgeActor(access.actor, async () => handler[method]!(inner));
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
}
