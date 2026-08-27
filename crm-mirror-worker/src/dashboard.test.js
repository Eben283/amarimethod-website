import { describe, expect, it } from "vitest";
import { dashboardHtml } from "./dashboard.js";

describe("CRM mirror dashboard", () => {
  it("is a read-only shell that requires protected access before loading aggregates", () => {
    const html = dashboardHtml();
    expect(html).toContain("Read-only operator view");
    expect(html).toContain('id="access-hint"');
    expect(html).toContain("Open this dashboard from Staff → Operations → CRM Mirror");
    expect(html).toContain("ops-surface-nav");
    expect(html).toContain("Automation Watch");
    expect(html).not.toContain('id="unlock"');
    expect(html).not.toContain("Unlock dashboard");
    expect(html).not.toContain("WORKER_AUTH_SECRET");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain('fetch("/dashboard-session"');
    expect(html).toContain('const dashboardSession = hash.get("dashboard_session")');
    expect(html).toContain('headers.set("X-Amari-Dashboard-Session", dashboardSession)');
    expect(html).toContain('dashboardFetch("/review-session")');
    expect(html).toContain('dashboardFetch("/status")');
    expect(html).toContain('dashboardFetch("/operations?limit=25")');
    expect(html).toContain("Active client operations");
    expect(html).toContain("Client profiles");
    expect(html).toContain("Ledger cutover review");
    expect(html).toContain("Monitoring only; GHL remains production");
    expect(html).toContain('dashboardFetch("/ledger-cutover?limit=25")');
    expect(html).toContain("Approve opening balance");
    expect(html).toContain('dashboardFetch("/contacts?limit=12&query="');
    expect(html).toContain('dashboardFetch("/contacts/" + encodeURIComponent(contactId) + "?limit=25")');
    expect(html).toContain("GHL-imported session fields");
    expect(html).toContain("Purchase records");
    expect(html).toContain("this is not a work queue");
    expect(html).toContain('dashboardFetch("/reconciliation")');
    expect(html).toContain('dashboardFetch("/reconciliation/review?limit=50")');
    expect(html).toContain("Approve link");
    expect(html).toContain("Mark legacy package");
    expect(html).toContain("Not a session package");
    expect(html).toContain("elevated review session");
    expect(html).toContain("Exact email evidence, pending review");
    expect(html).toContain("It cannot send email or SMS");
    expect(html).toContain('amari:staff-crm-session-expired');
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
