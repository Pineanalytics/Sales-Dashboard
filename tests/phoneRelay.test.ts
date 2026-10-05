import { constants, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_ONLINE_MS, CLAIMED_TTL_MS, COMMAND_TTL_MS, checkKey, enqueueCommand, getPhoneView, getRelayState, resetRelayStateForTests, syncAgent,
} from "@/lib/phoneRelay";
import { PHONE_MANIFEST, PHONE_PAGE, PHONE_SW } from "@/lib/phoneRelayPage";

const env = { PHONE_RELAY_KEY: "phone-secret", PHONE_RELAY_AGENT_KEY: "agent-secret" } as unknown as NodeJS.ProcessEnv;
const T0 = 1_800_000_000_000;

beforeEach(() => resetRelayStateForTests());

describe("relay keys", () => {
  it("is disabled until the env secrets exist, never granting access by omission", () => {
    expect(checkKey("phone", "anything", "1.1.1.1", T0, {} as NodeJS.ProcessEnv)).toBe("unconfigured");
    expect(checkKey("agent", "anything", "1.1.1.1", T0, {} as NodeJS.ProcessEnv)).toBe("unconfigured");
  });
  it("keeps the phone key and agent key separate", () => {
    expect(checkKey("phone", "phone-secret", "1.1.1.1", T0, env)).toBe("ok");
    expect(checkKey("phone", "agent-secret", "1.1.1.1", T0, env)).toBe("denied");
    expect(checkKey("agent", "agent-secret", "1.1.1.1", T0, env)).toBe("ok");
    expect(checkKey("agent", "phone-secret", "1.1.1.1", T0, env)).toBe("denied");
    expect(checkKey("phone", null, "1.1.1.1", T0, env)).toBe("denied");
  });
  it("throttles repeated WRONG keys per address, but a correct key is never blocked", () => {
    for (let i = 0; i < 5; i++) expect(checkKey("phone", `bad${i}`, "9.9.9.9", T0, env)).toBe("denied");
    expect(checkKey("phone", "bad-again", "9.9.9.9", T0 + 1000, env)).toBe("locked");
    // The office phone and both PC agents share one public address: a mis-paired phone must
    // not be able to lock the PC agents (or itself, once re-paired) out.
    expect(checkKey("phone", "phone-secret", "9.9.9.9", T0 + 1000, env)).toBe("ok");
    expect(checkKey("agent", "agent-secret", "9.9.9.9", T0 + 1000, env)).toBe("ok");
    expect(checkKey("phone", "bad-again", "8.8.8.8", T0 + 1000, env)).toBe("denied"); // other addresses have their own count
    expect(checkKey("phone", "bad-late", "9.9.9.9", T0 + 16 * 60_000, env)).toBe("denied"); // window expired
  });
  it("does not count a missing key as a failed guess", () => {
    for (let i = 0; i < 20; i++) expect(checkKey("phone", null, "7.7.7.7", T0 + i, env)).toBe("denied");
    expect(checkKey("phone", "wrong", "7.7.7.7", T0 + 100, env)).toBe("denied"); // still only the first wrong guess
  });
});

describe("commands", () => {
  it("validates types, payloads and dates", () => {
    expect(enqueueCommand({ type: "nope" }, "c", T0)).toMatchObject({ ok: false, status: 400 });
    expect(enqueueCommand({ type: "login" }, "c", T0)).toMatchObject({ ok: false, status: 400 }); // no cipher
    expect(enqueueCommand({ type: "login", cipher: "not base64!!" }, "c", T0)).toMatchObject({ ok: false });
    expect(enqueueCommand({ type: "login", cipher: "A".repeat(2000) }, "c", T0)).toMatchObject({ ok: false });
    expect(enqueueCommand({ type: "backfill" }, "c", T0)).toMatchObject({ ok: false });
    expect(enqueueCommand({ type: "backfill", date: "2026-13-45" }, "c", T0)).toMatchObject({ ok: false });
    expect(enqueueCommand({ type: "backfill", date: "2026-09-05" }, "c", T0)).toMatchObject({ ok: true });
    expect(enqueueCommand({ type: "start" }, "c", T0)).toMatchObject({ ok: true });
  });
  it("routes each command to the right agent and delivers it exactly once", () => {
    enqueueCommand({ type: "login", cipher: "QUJD" }, "c", T0);
    enqueueCommand({ type: "start" }, "c", T0);
    const automation = syncAgent("automation", { status: { stage: "need-password" } }, T0 + 1000);
    expect(automation.ok && automation.commands.map((c) => c.type)).toEqual(["login"]);
    const panel = syncAgent("panel", {}, T0 + 1000);
    expect(panel.ok && panel.commands.map((c) => c.type)).toEqual(["start"]);
    const again = syncAgent("automation", {}, T0 + 2000);
    expect(again.ok && again.commands).toEqual([]); // already claimed
  });
  it("lets a newer login attempt replace an older unclaimed one", () => {
    enqueueCommand({ type: "login", cipher: "QUJD" }, "c", T0);
    enqueueCommand({ type: "login", cipher: "REVG" }, "c", T0 + 10);
    const r = syncAgent("automation", {}, T0 + 20);
    expect(r.ok && r.commands.map((c) => c.cipher)).toEqual(["REVG"]);
  });
  it("expires unclaimed and unreported commands so stale credentials never linger", () => {
    enqueueCommand({ type: "login", cipher: "QUJD" }, "c", T0);
    const late = syncAgent("automation", {}, T0 + COMMAND_TTL_MS + 1);
    expect(late.ok && late.commands).toEqual([]);
    expect(getRelayState().commands).toEqual([]);
    enqueueCommand({ type: "mfa", cipher: "QUJD" }, "c", T0);
    syncAgent("automation", {}, T0 + 1000); // claimed, never reports back
    syncAgent("automation", {}, T0 + 1000 + CLAIMED_TTL_MS + 1);
    expect(getRelayState().commands).toEqual([]);
  });
  it("rate-limits command submissions and caps the queue", () => {
    for (let i = 0; i < 10; i++) expect(enqueueCommand({ type: "start" }, "spammer", T0 + i)).toMatchObject({ ok: true });
    expect(enqueueCommand({ type: "start" }, "spammer", T0 + 11)).toMatchObject({ ok: false, status: 429 });
    expect(enqueueCommand({ type: "start" }, "other", T0 + 11)).toMatchObject({ ok: true });
  });
});

describe("agent sync and the phone view", () => {
  it("records results against the command and exposes them to the phone, newest first", () => {
    const sent = enqueueCommand({ type: "start" }, "c", T0);
    if (!sent.ok) throw new Error("setup");
    syncAgent("panel", {}, T0 + 100);
    syncAgent("panel", { results: [{ id: sent.id, ok: true, message: "Started" }, { id: "unknown-id", ok: true, message: "ignored" }] }, T0 + 200);
    const view = getPhoneView(T0 + 300);
    expect(view.results).toEqual([{ id: sent.id, type: "start", ok: true, message: "Started", at: T0 + 200 }]);
    expect(view.pending).toBe(0);
  });
  it("ignores a result reported by the wrong agent", () => {
    const sent = enqueueCommand({ type: "login", cipher: "QUJD" }, "c", T0);
    if (!sent.ok) throw new Error("setup");
    syncAgent("automation", {}, T0 + 100);
    syncAgent("panel", { results: [{ id: sent.id, ok: true, message: "forged" }] }, T0 + 200);
    expect(getPhoneView(T0 + 300).results).toEqual([]);
  });
  it("tracks agent online-ness and only accepts the public key from the automation agent", () => {
    syncAgent("panel", { publicKey: "AAAA" }, T0);
    expect(getPhoneView(T0).publicKey).toBeNull();
    syncAgent("automation", { publicKey: "QUJD", status: { stage: "logged-in" } }, T0);
    const online = getPhoneView(T0 + 1000);
    expect(online.publicKey).toBe("QUJD");
    expect(online.agents.automation).toMatchObject({ online: true, status: { stage: "logged-in" } });
    expect(getPhoneView(T0 + AGENT_ONLINE_MS + 1).agents.automation.online).toBe(false);
  });
  it("rejects an oversized status payload", () => {
    expect(syncAgent("automation", { status: { blob: "x".repeat(9000) } }, T0)).toMatchObject({ ok: false, status: 413 });
  });
});

describe("end-to-end encryption contract (phone WebCrypto -> PC Node crypto)", () => {
  it("a payload encrypted exactly as the phone page does decrypts on the PC, and the fingerprint matches", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const spki = publicKey.export({ type: "spki", format: "der" });
    const spkiB64 = spki.toString("base64");
    // What the page does: import the SPKI, RSA-OAEP/SHA-256 encrypt JSON {t,v,ts,n}.
    const key = await crypto.subtle.importKey("spki", Uint8Array.from(spki), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const longPassword = "p".repeat(80); // the login field allows up to 80 characters
    const payload = JSON.stringify({ t: "login", v: longPassword, ts: T0, n: "0123456789abcdef01234567" });
    const cipher = Buffer.from(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(payload)));
    expect(cipher.toString("base64").length).toBeLessThanOrEqual(1024); // fits the relay's size cap
    // What the PC agent does:
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, cipher).toString("utf8");
    expect(JSON.parse(plain)).toMatchObject({ t: "login", v: longPassword });
    // Fingerprint pinning: sha256(SPKI DER) in hex, same on both sides.
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", Uint8Array.from(spki))).toString("hex");
    expect(digest).toBe(createHash("sha256").update(spki).digest("hex"));
    expect(spkiB64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("server agent (PINEFROSTSERVER)", () => {
  it("routes server-* commands to the server agent only, never to the PC agents", () => {
    for (const type of ["server-pull", "server-halt", "server-resume"]) enqueueCommand({ type }, "c" + type, T0);
    enqueueCommand({ type: "start" }, "c", T0);
    const pc = syncAgent("panel", {}, T0 + 100);
    expect(pc.ok && pc.commands.map((c) => c.type)).toEqual(["start"]);
    const auto = syncAgent("automation", {}, T0 + 100);
    expect(auto.ok && auto.commands).toEqual([]);
    const server = syncAgent("server", { status: { tasks: [{ name: "Today", state: "Ready" }] } }, T0 + 100);
    expect(server.ok && server.commands.map((c) => c.type).sort()).toEqual(["server-halt", "server-pull", "server-resume"]);
  });
  it("server-backfill needs a real date and only carries replace when it is exactly true", () => {
    expect(enqueueCommand({ type: "server-backfill" }, "c", T0)).toMatchObject({ ok: false, status: 400 });
    expect(enqueueCommand({ type: "server-backfill", date: "2026-02-30x" }, "c", T0)).toMatchObject({ ok: false });
    expect(enqueueCommand({ type: "server-backfill", date: "2026-09-10", replace: "yes" }, "c", T0)).toMatchObject({ ok: true });
    expect(enqueueCommand({ type: "server-backfill", date: "2026-09-11", replace: true }, "c2", T0)).toMatchObject({ ok: true });
    const r = syncAgent("server", {}, T0 + 10);
    expect(r.ok && r.commands.map((c) => [c.date, c.replace])).toEqual([["2026-09-10", undefined], ["2026-09-11", true]]);
  });
  it("shows the server agent to the phone, offline until it syncs, and only that agent can report its results", () => {
    expect(getPhoneView(T0).agents.server).toMatchObject({ online: false });
    const sent = enqueueCommand({ type: "server-pull" }, "c", T0);
    if (!sent.ok) throw new Error("setup");
    syncAgent("server", { status: { vpsOk: true } }, T0 + 10);
    syncAgent("panel", { results: [{ id: sent.id, ok: true, message: "forged" }] }, T0 + 20);
    expect(getPhoneView(T0 + 30).results).toEqual([]);
    syncAgent("server", { results: [{ id: sent.id, ok: true, message: "Delivered" }] }, T0 + 40);
    const view = getPhoneView(T0 + 50);
    expect(view.agents.server).toMatchObject({ online: true, status: { vpsOk: true } });
    expect(view.results[0]).toMatchObject({ type: "server-pull", ok: true, message: "Delivered" });
  });
  it("the phone page offers the four server actions", () => {
    for (const a of ["server-pull", "server-halt", "server-resume", "server-backfill"]) expect(PHONE_PAGE).toContain(a);
  });
});

describe("phone page assets", () => {
  it("the embedded script is valid JavaScript with no template-literal hazards", () => {
    const script = PHONE_PAGE.split("<script>")[1]!.split("</script>")[0]!;
    expect(script).not.toContain("`");
    expect(script).not.toContain("${");
    expect(() => new Function(script)).not.toThrow();
  });
  it("never embeds or asks the server for plaintext credentials", () => {
    expect(PHONE_PAGE).toContain("RSA-OAEP");
    expect(PHONE_PAGE).toContain("checkPin"); // refuses to encrypt to an unpinned key
    expect(PHONE_PAGE).not.toMatch(/localStorage\.setItem\([^)]*(pw|password|code)/i);
  });
  it("is installable: manifest has both icons and a scope, and the service worker never intercepts", () => {
    expect(PHONE_MANIFEST.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
    expect(PHONE_MANIFEST.display).toBe("standalone");
    expect(PHONE_SW).not.toContain("respondWith");
    expect(PHONE_SW).not.toContain("caches");
  });
});
