import { describe, expect, it } from "vitest";
import { dashboardHtml } from "./dashboard.js";

describe("CRM mirror dashboard", () => {
  it("is a read-only shell that requires protected access before loading aggregates", () => {
    const html = dashboardHtml();
    expect(html).toContain("Read-only operator view");
    expect(html).toContain('fetch("/status", { headers })');
    expect(html).toContain('fetch("/reconciliation", { headers })');
    expect(html).toContain("history.replaceState");
    expect(html).toContain("It cannot send email or SMS");
  });
});
