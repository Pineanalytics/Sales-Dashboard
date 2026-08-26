import { auth } from "@/auth";
import { rewriteEablDsrDashboardHtml, validateEablDsrProxyPath } from "@/lib/eablDsrProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_UPSTREAM = "http://172.18.0.1:8000";
const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
].join("; ");

async function proxy(request: Request, context: RouteContext<"/api/eabl-dsr-review/[...path]">) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (session.user.role !== "ADMIN" && !session.user.allowedPages?.includes("timestamps")) {
    return Response.json({ error: "You don't have access to EABL DSR Review." }, { status: 403 });
  }

  const { path } = await context.params;
  const safePath = validateEablDsrProxyPath(path);
  if (!safePath) return Response.json({ error: "Unsupported EABL DSR path." }, { status: 404 });

  const upstreamBase = process.env.EABL_DSR_REVIEW_URL?.trim() || DEFAULT_UPSTREAM;
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(safePath, upstreamBase);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers({ accept: request.headers.get("accept") ?? "*/*" });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  try {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(90_000),
    });

    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-disposition", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("cache-control", "no-store, private");

    if (upstream.headers.get("content-type")?.includes("text/html")) {
      responseHeaders.set("content-type", "text/html; charset=utf-8");
      responseHeaders.set("content-security-policy", HTML_CSP);
      return new Response(rewriteEablDsrDashboardHtml(await upstream.text()), {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("Failed to proxy EABL DSR Review", error);
    return Response.json({ error: "The EABL DSR service is temporarily unavailable." }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
