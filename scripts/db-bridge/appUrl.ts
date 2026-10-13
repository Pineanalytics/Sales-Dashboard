// The dashboard's canonical address is the apex host (https://pinefrostdb.com). A machine whose .env or script names the www host
// reaches the same app, but pages on www answer with a 301 and a POST that is redirected becomes a GET, so an upload sent there
// fails. This turns a www address into the apex one (and trims a trailing slash) so every bridge talks to the canonical host.
export function canonicalAppUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/^(https?:\/\/)www\.(pinefrostdb\.com)/i, "$1$2");
}
