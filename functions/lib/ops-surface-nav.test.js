import { describe, expect, it } from "vitest";
import { OPS_SURFACE_NAV_CSS, opsEmbedBootScript, opsSurfaceNavHtml } from "./ops-surface-nav.js";

describe("ops surface nav", () => {
  it("marks the active tab and links the three operator surfaces", () => {
    const html = opsSurfaceNavHtml("crm");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Systems");
    expect(html).toContain("CRM Mirror");
    expect(html).toContain("Automation Watch");
    expect(html).toContain("https://www.amarimethod.com/ops");
    expect(html).toContain("https://amari-crm-mirror.eben-fa2.workers.dev/");
    expect(html).toContain("https://reminder-engine.eben-fa2.workers.dev/dashboard");
    expect(html).toContain("/staff/operations");
  });

  it("ships embed chrome CSS and boot script", () => {
    expect(OPS_SURFACE_NAV_CSS).toContain(".ops-surface-nav");
    expect(opsEmbedBootScript()).toContain("ops-embed");
  });
});
