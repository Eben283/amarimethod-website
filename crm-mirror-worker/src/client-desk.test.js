import { describe, expect, it } from "vitest";
import { clientDeskHtml } from "./client-desk.js";

describe("Client Desk email rendering", () => {
  it("replaces raw email destinations with labelled, private links", () => {
    const html = clientDeskHtml();
    expect(html).toContain("function emailLinkLabel");
    expect(html).toContain("Upgrade to 4 sessions");
    expect(html).toContain("Upgrade to 8 sessions");
    expect(html).toContain("Share feedback");
    expect(html).toContain("Unsubscribe");
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain("kind === 'email' ? emailBody(content) : esc(cleanMessage(content))");
  });
});
