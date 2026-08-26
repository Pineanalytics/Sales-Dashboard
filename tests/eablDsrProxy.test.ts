import { describe, expect, it } from "vitest";
import { rewriteEablDsrDashboardHtml, validateEablDsrProxyPath } from "@/lib/eablDsrProxy";

describe("EABL DSR proxy", () => {
  it("allows only the two adopted report roots", () => {
    expect(validateEablDsrProxyPath(["dsr", "summary"])).toBe("/dsr/summary");
    expect(validateEablDsrProxyPath(["sales-analytics", "coverage", "summary"])).toBe("/sales-analytics/coverage/summary");
    expect(validateEablDsrProxyPath(["health"])).toBeNull();
    expect(validateEablDsrProxyPath(["dsr", "..", "health"])).toBeNull();
  });

  it("keeps legacy fetch calls inside the authenticated proxy", () => {
    const html = "<title>Pinefrost Analytics</title><script>fetch(`/dsr/\${path}?\${qs}`);fetch('/dsr/signoff',{method:'POST'})</script>";
    const rewritten = rewriteEablDsrDashboardHtml(html);
    expect(rewritten).toContain("fetch(`/api/eabl-dsr-review/dsr/");
    expect(rewritten).toContain("fetch('/api/eabl-dsr-review/dsr/signoff'");
    expect(rewritten).toContain("<title>EABL DSR Review · Pinefrost Analytics");
  });
});
