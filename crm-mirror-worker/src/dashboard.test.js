import { describe, expect, it } from "vitest";
import { dashboardHtml } from "./dashboard.js";

describe("CRM mirror dashboard", () => {
  it("is a read-only shell that requires protected access before loading aggregates", () => {
    const html = dashboardHtml();
    expect(html).toContain("Read-only operator view");
    expect(html).toContain('fetch("/dashboard-session"');
    expect(html).toContain('fetch("/review-session"');
    expect(html).toContain('fetch("/status", { credentials: "same-origin" })');
    expect(html).toContain('fetch("/operations?limit=25", { credentials: "same-origin" })');
    expect(html).toContain("Active client operations");
    expect(html).toContain("Client profiles");
    expect(html).toContain("Ledger cutover review");
    expect(html).toContain("Monitoring only; GHL remains production");
    expect(html).toContain('fetch("/ledger-cutover?limit=25"');
    expect(html).toContain("Approve opening balance");
    expect(html).toContain('fetch("/contacts?limit=12&query="');
    expect(html).toContain('fetch("/contacts/" + encodeURIComponent(contactId) + "?limit=25"');
    expect(html).toContain("GHL-imported session fields");
    expect(html).toContain("Purchase records");
    expect(html).toContain("this is not a work queue");
    expect(html).toContain('fetch("/reconciliation", { credentials: "same-origin" })');
    expect(html).toContain('fetch("/reconciliation/review?limit=50", { credentials: "same-origin" })');
    expect(html).toContain("Approve link");
    expect(html).toContain("Mark legacy package");
    expect(html).toContain("Not a session package");
    expect(html).toContain("elevated review session");
    expect(html).toContain("Exact email evidence, pending review");
    expect(html).toContain("history.replaceState");
    expect(html).toContain("It cannot send email or SMS");
    expect(html).toContain('id="unlock"');
    expect(html).toContain("Unlock dashboard");
  });

  it("renders only aggregate source health when the Worker has an authenticated session", () => {
    const html = dashboardHtml({
      contacts: 718,
      appointments: 202,
      purchases: 52,
      syncHealth: {
        overall: "healthy",
        providers: {
          ghl: { state: "healthy", ageMinutes: 3 },
          stripe: { state: "healthy", ageMinutes: 4 },
        },
      },
    });
    expect(html).toContain("Protected server summary loaded");
    expect(html).toContain('id="contacts">718');
    expect(html).toContain('id="appointments">202');
    expect(html).toContain('id="purchases">52');
    expect(html).toContain('id="last-import">Healthy');
    expect(html).not.toContain("__SERVER_");
  });
});
