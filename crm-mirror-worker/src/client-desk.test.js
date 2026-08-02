import { describe, expect, it } from "vitest";
import { clientDeskHtml } from "./client-desk.js";

describe("Client Desk message rendering", () => {
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
});
