import { describe, expect, it } from "vitest";
import { dashboardHtml } from "./dashboard.js";

describe("CRM mirror dashboard", () => {
  it("is a read-only shell that requires protected access before loading aggregates", () => {
    const html = dashboardHtml();
    expect(html).toContain("Read-only operator view");
    expect(html).toContain('fetch("/dashboard-session"');
    expect(html).toContain('fetch("/status", { credentials: "same-origin" })');
    expect(html).toContain('fetch("/reconciliation", { credentials: "same-origin" })');
    expect(html).toContain('fetch("/reconciliation/review?limit=50", { credentials: "same-origin" })');
    expect(html).toContain("This screen does not approve a link");
    expect(html).toContain("Exact email evidence, pending review");
    expect(html).toContain("history.replaceState");
    expect(html).toContain("It cannot send email or SMS");
  });
});
