import { describe, expect, it } from "vitest";
import { clientDeskHtml } from "./client-desk.js";

describe("Client Desk message rendering", () => {
  it("identifies the desk as a client inbox rather than an operations-message view", () => {
    const html = clientDeskHtml();
    expect(html).toContain("Automated status notices are filtered without hiding the person’s record.");
    expect(html).toContain("selected client record beside them");
  });

  it("does not expose operator-surface navigation inside Client Desk", () => {
    const html = clientDeskHtml();
    expect(html).not.toContain("Systems");
    expect(html).not.toContain("CRM Mirror");
    expect(html).not.toContain("Automation Watch");
    expect(html).not.toContain("Staff hub");
  });

  it("includes an explicit staff email composer rather than automatic outreach", () => {
    const html = clientDeskHtml();
    expect(html).toContain('id="email-compose"');
    expect(html).toContain('name="from"');
    expect(html).toContain("/client-desk/email-senders");
    expect(html).toContain("/client-desk/contacts/' + encodeURIComponent(contactId) + '/email");
    expect(html).toContain("Sends email now");
    expect(html).toContain("blocked for email opt-out or DND");
    expect(html).toContain("from: fields.get('from')");
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

  it("marks a record's data boundaries and unknowns without treating them as client status", () => {
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

    for (const label of ["Record status", "Last mirrored activity", "Next appointment", "GHL mirror", "Stripe mirror", "Not mirrored"]) expect(rendered).toContain(label);
    expect(rendered).toContain("Consent status not mirrored");
    expect(rendered).not.toContain("No opt-out recorded");
  });
});
