import { describe, expect, it } from "vitest";
import { clientDeskHtml } from "./client-desk.js";

describe("Client Desk message rendering", () => {
  it("cleans tracking destinations before inserting message text", () => {
    const html = clientDeskHtml();
    expect(html).toContain("const cleanMessage");
    expect(html).toContain("[Amari link]");
    expect(html).toContain("If you no longer wish to receive these emails");
    expect(html).toContain("esc(content)");
  });
});
