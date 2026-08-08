import { describe, expect, it, vi } from "vitest";
import { clientDeskHtml } from "./client-desk.js";

describe("Client Desk message rendering", () => {
  it("identifies the desk as the complete chronological communication surface", () => {
    const html = clientDeskHtml();
    expect(html).toContain("Every mirrored contact, ordered by most recent activity.");
    expect(html).toContain("Client, automated, and operational messages remain visible");
    expect(html).toContain(">All contacts<");
    expect(html).toContain("limit: '1000'");
    expect(html).toContain("No communication mirrored yet.");
    expect(html).toContain("No activity");
    expect(html).toContain("timelineDayKey");
  });

  it("shows accurate relative ages and the exact source timestamp on contact cards", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { activityAge, threadTime }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T17:00:00.000Z"));
    try {
      expect(helpers.activityAge("2026-08-08T16:05:00.000Z")).toBe("55 minutes ago");
      expect(helpers.activityAge("2026-08-08T16:00:00.000Z")).toBe("1 hour ago");
      expect(helpers.threadTime("2026-08-08T16:05:00.000Z")).toContain("55 minutes ago");
      expect(helpers.threadTime("2026-08-08T16:05:00.000Z")).toContain('class="thread-exact-time"');
      expect(helpers.threadTime("2026-08-08T16:05:00.000Z")).not.toContain("Now");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expose operator-surface navigation inside Client Desk", () => {
    const html = clientDeskHtml();
    expect(html).not.toContain("Systems");
    expect(html).not.toContain("CRM Mirror");
    expect(html).not.toContain("Automation Watch");
    expect(html).not.toContain("Staff hub");
  });

  it("keeps the Desk read-only until Gmail replies and delivery reconciliation are mirrored", () => {
    const html = clientDeskHtml();
    expect(html).toContain("This mirror does not send messages.");
    expect(html).toContain("Sending stays in the approved staff channel.");
    expect(html).not.toContain('id="email-compose"');
    expect(html).not.toContain("/client-desk/email-senders");
    expect(html).not.toContain("/client-desk/contacts/' + encodeURIComponent(contactId) + '/email");
  });

  it("keeps the composer anchored below a separately scrollable timeline", () => {
    const html = clientDeskHtml();
    expect(html).toContain(".timeline-scroll { min-height: 0; flex: 1; overflow: auto; }");
    expect(html).toContain("height: clamp(560px, calc(100vh - 230px), 840px)");
    expect(html).toContain('<div class="timeline-scroll"><div class="timeline">');
    expect(html).toContain("flex: 0 0 auto");
  });

  it("keeps consent auditing out of the Client Desk interface", () => {
    const html = clientDeskHtml();
    expect(html).not.toContain("Contactability review");
    expect(html).not.toContain("/consent-review");
  });

  it("renders separate Stripe invoice context without calling an invoice a payment", () => {
    const html = clientDeskHtml();
    expect(html).toContain("<h3>Invoices</h3>");
    expect(html).toContain("Invoices are mirrored from Stripe when their source customer relationship is unambiguous.");
    expect(html).toContain("event.activity_type === 'invoice'");
  });

  it("keeps Stripe payment evidence separate from the mirrored GHL access state", () => {
    const html = clientDeskHtml();
    expect(html).toContain("Payment &amp; access");
    expect(html).toContain("Stripe payment evidence and GHL access are mirrored separately.");
    expect(html).toContain("This view never changes either system.");
    expect(html).toContain("paymentAccess.label");
  });

  it("renders a review state without presenting it as an access change", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { profileMarkup }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const rendered = helpers.profileMarkup({
      contact: { display_name: "Test client" },
      paymentAccess: {
        status: "review_access_state",
        label: "Review current access",
        detail: "A linked Stripe package payment is recorded, but the GHL access mirror is missing: portal access.",
        payment: { classification: "8-Session Series" },
      },
    });
    expect(rendered).toContain("Payment &amp; access");
    expect(rendered).toContain("Stripe payment");
    expect(rendered).toContain("Review current access");
    expect(rendered).not.toContain("Activate access");
  });

  it("cleans inbox previews without changing the underlying message record", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { cleanMessage }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const preview = helpers.cleanMessage(".ProseMirror > p {margin: 0px;} Hi there https://link.amarimethod.com/track?private=token If you no longer wish to receive these emails unsubscribe");
    expect(preview).toBe("Hi there [Amari link]");
  });

  it("keeps each inbox preview compact while preserving the full timeline content", () => {
    const html = clientDeskHtml();
    expect(html).toContain(".thread-row > span:nth-child(2) { min-width: 0; }");
    expect(html).toContain("max-height: 2.76em");
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { inboxPreview }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const longPreview = "A concise first sentence " + "additional detail ".repeat(30);
    expect(helpers.inboxPreview(longPreview).length).toBeLessThanOrEqual(170);
    expect(helpers.inboxPreview(longPreview)).toMatch(/…$/);
    expect(html).toContain("event.body || event.body_clean || event.subject || 'No message content mirrored.';");
  });

  it("renders email destinations as safe labelled links", () => {
    const html = clientDeskHtml();
    for (const label of ["Upgrade to 4 sessions", "Upgrade to 8 sessions", "Share feedback", "Book a session", "Visit Amari Method", "Unsubscribe", "Open link"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain("kind === 'email' ? emailBody(content) : esc(cleanMessage(content))");
  });

  it("keeps email hrefs while rendering a concise tracking-link label", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { emailBody, emailLinkLabel }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const url = "https://link.amarimethod.com/email-tracking?contactId=private-contact&token=private-token";
    const rendered = helpers.emailBody(`Upgrade to 4 sessions ${url}`);
    expect(rendered).toContain(`href=\"${url.replace("&", "&amp;")}\"`);
    expect(rendered).toContain(">Upgrade to 4 sessions<");
    expect(rendered).not.toContain(`>${url}<`);
    expect(rendered).toContain('rel="noopener noreferrer"');
    expect(rendered).toContain('referrerpolicy="no-referrer"');
    const tracked = "https://link.amarimethod.com/email-tracking?contactId=private-contact";
    expect(helpers.emailLinkLabel(tracked, "Upgrade to 8 sessions")).toBe("Upgrade to 8 sessions");
    expect(helpers.emailLinkLabel(tracked, "Share your feedback")).toBe("Share feedback");
    expect(helpers.emailLinkLabel(tracked, "Book your session")).toBe("Book a session");
    expect(helpers.emailLinkLabel("https://www.amarimethod.com/stories", "")).toBe("Visit Amari Method");
    expect(helpers.emailLinkLabel("https://services.msgsndr.com/unsubscribe?token=private", "")).toBe("Unsubscribe");
    expect(helpers.emailLinkLabel("https://cdn.example.com/image.png", "")).toBe("Open link");
  });

  it("replaces bracketed appointment URLs with concise clickable actions", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { emailBody }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const booking = "https://link.amarimethod.com/widget/booking?event_id=private";
    const cancel = "https://link.amarimethod.com/widget/cancel-booking?event_id=private";
    const google = "https://link.amarimethod.com/google/calendar/add-event/private";
    const ics = "https://link.amarimethod.com/google/calendar/get-ics/private";
    const rendered = helpers.emailBody(`Reschedule [${booking}] · Cancel [${cancel}] Add to Google Calendar [${google}] · Add to iCal / Outlook [${ics}]`);
    for (const label of ["Reschedule", "Cancel", "Add to Google Calendar", "Add to iCal / Outlook"]) expect(rendered).toContain(`>${label}<`);
    for (const url of [booking, cancel, google, ics]) expect(rendered).toContain(`href=\"${url.replace("&", "&amp;")}\"`);
    expect(rendered).not.toContain(`[${booking}]`);
    expect(rendered).not.toContain(`[${cancel}]`);
    expect(rendered).toContain('target="_blank"');
    expect(rendered).toContain('rel="noopener noreferrer"');
    expect(rendered).toContain('referrerpolicy="no-referrer"');
  });

  it("filters a selected client's loaded timeline locally by record type", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { filterTimeline }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const timeline = [
      { activity_type: "message", channel: "email" },
      { activity_type: "appointment" },
      { activity_type: "payment" },
      { activity_type: "invoice" },
      { activity_type: "note" },
      { activity_type: "task" },
    ];

    expect(helpers.filterTimeline(timeline, "all")).toEqual(timeline);
    expect(helpers.filterTimeline(timeline, "messages")).toEqual([timeline[0]]);
    expect(helpers.filterTimeline(timeline, "appointments")).toEqual([timeline[1]]);
    expect(helpers.filterTimeline(timeline, "payments")).toEqual([timeline[2]]);
    expect(helpers.filterTimeline(timeline, "invoices")).toEqual([timeline[3]]);
    expect(helpers.filterTimeline(timeline, "notes")).toEqual([timeline[4]]);
    expect(helpers.filterTimeline(timeline, "tasks")).toEqual([timeline[5]]);
  });

  it("shows DND as an unambiguous on-or-off contact state", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { profileMarkup }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const rendered = helpers.profileMarkup({
      contact: { display_name: "Test client" },
      activityTimeline: [{ occurred_at: "2026-08-08T14:00:00.000Z" }],
      appointments: [{ status: "confirmed", starts_at: "2026-08-10T14:00:00.000Z" }],
    });

    for (const label of ["Open record", "Activity", "Appointments", "Payments", "Notes"]) expect(rendered).toContain(label);
    for (const target of ["activity", "appointments", "payments", "notes"]) expect(rendered).toContain(`data-record-target="${target}"`);
    expect(rendered).toContain('<button class="status-card"');
    expect(rendered).toContain('class="status-arrow"');
    expect(rendered).toContain("DND");
    expect(rendered).toContain(">Off<");
    expect(rendered).not.toContain("SMS permission");
    expect(rendered).not.toContain("Email permission");
    expect(rendered).not.toContain("Consent status not mirrored");
    expect(rendered).toContain("DND is shown as on or off.");

    const dndOn = helpers.profileMarkup({ contact: { display_name: "Test client" }, fields: [{ attribute_key: "system.dnd", attribute_value: "on" }] });
    expect(dndOn).toContain(">On<");
  });

  it("opens complete upcoming and past appointment views from the record launcher", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { profileMarkup }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T17:00:00.000Z"));
    try {
      const rendered = helpers.profileMarkup({
        contact: { display_name: "Test client" },
        appointments: [
          { status: "confirmed", starts_at: "2026-08-11T18:00:00.000Z", service_name: "Follow-up Session" },
          { status: "showed", starts_at: "2026-08-04T20:00:00.000Z", service_name: "Assessment" },
        ],
        purchases: [{ amount_cents: 300000, currency: "usd", provider_status: "succeeded", purchased_at: "2026-08-04T20:00:00.000Z" }],
        notes: [{ authored_by: "Garrett", created_at: "2026-08-04T20:00:00.000Z", body: "Practice note" }],
      });
      expect(rendered).toContain('data-appointment-tab="upcoming"');
      expect(rendered).toContain('data-appointment-tab="past"');
      expect(rendered).toContain("Upcoming · 1");
      expect(rendered).toContain("Past · 1");
      expect(rendered).toContain("Follow-up Session");
      expect(rendered).toContain("Assessment");
      expect(rendered).toContain('id="record-payments"');
      expect(rendered).toContain('id="record-notes"');
      expect(rendered).toContain("Practice note");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a complete payment ledger and an exact-member Staff POS charge flow", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { profileMarkup }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const rendered = helpers.profileMarkup({
      contact: { display_name: "Test client", ghl_contact_id: "ghl contact/1" },
      purchases: [
        { amount_cents: 2900, amount_refunded_cents: 0, currency: "usd", provider_status: "succeeded", purchased_at: "2026-07-29T20:00:00.000Z" },
        { amount_cents: 5000, amount_refunded_cents: 0, currency: "usd", provider_status: "failed", purchased_at: "2026-07-28T20:00:00.000Z" },
      ],
      purchaseCandidates: [
        { amount_cents: 300000, amount_refunded_cents: 0, currency: "usd", provider_status: "succeeded", purchased_at: "2026-08-04T20:00:00.000Z", identity_status: "match_review" },
      ],
    });

    expect(rendered).toContain('class="payment-ledger"');
    for (const heading of ["Date", "Amount", "Status"]) expect(rendered).toContain(`>${heading}<`);
    expect(rendered).toContain("$3,029.00");
    expect(rendered).toContain("Stripe evidence");
    expect(rendered).toContain("Match review");
    expect(rendered).toContain("not yet used for access or session records");
    expect(rendered).toContain('data-payment-actions');
    expect(rendered).toContain("Charge now");
    expect(rendered).toContain("contact=ghl%20contact%2F1&amp;action=charge");
    expect(rendered).toContain('target="_top"');
  });

  it("keeps unread markers in the inbox and out of every timeline message", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { timelineItem }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    const rendered = helpers.timelineItem({ activity_type: "message", channel: "sms", direction: "inbound", body: "Hello", occurred_at: "2026-08-08T14:00:00.000Z" });

    expect(rendered).toContain("Client · sms");
    expect(clientDeskHtml()).toContain('.message .channel-mark { display: none; }');
    expect(clientDeskHtml()).toContain('blue-dot ');
  });

  it("uses an attention marker that is cleared only after a selected client record loads", () => {
    const html = clientDeskHtml();
    expect(html).toContain("needs attention");
    expect(html).toContain("/seen', { method: 'POST'");
    expect(html).toContain("unread_inbound_count: 0");
  });

  it("does not let a late detail response overwrite a newer selection", () => {
    const html = clientDeskHtml();
    expect(html).toContain("detailController?.abort()");
    expect(html).toContain("requestId !== detailRequest || selected !== contactId");
  });

  it("does not describe an unknown-direction message as client-authored", () => {
    const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
    const element = { value: "", textContent: "", innerHTML: "", addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const closing = script.lastIndexOf("})();");
    const instrumented = `${script.slice(0, closing)}return { timelineItem }; })();${script.slice(closing + 5)}`;
    const helpers = new Function("document", "fetch", `return (${instrumented.trim().slice(0, -1)})`)(document, async () => ({ ok: true, json: async () => ({ threads: [] }) }));
    expect(helpers.timelineItem({ activity_type: "message", channel: "sms", direction: "unknown", body: "Hello", occurred_at: "2026-08-08T14:00:00.000Z" })).toContain("Unclassified message · sms");
  });
});
