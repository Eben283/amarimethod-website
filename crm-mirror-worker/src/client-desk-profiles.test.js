import { describe, expect, it } from "vitest";

import { clientDeskHtml } from "./client-desk.js";

function browserHarness(actor = "Eben", storage = new Map()) {
  const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).at(-1);
  const element = {
    value: "", textContent: "", innerHTML: "", scrollTop: 0,
    addEventListener() {}, replaceChildren() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  };
  const document = { activeElement: null, getElementById: () => element, addEventListener() {} };
  const sessionStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  const token = `fixture.${Buffer.from(actor).toString("base64")}.proof`;
  const window = {
    location: { pathname: "/client-desk", search: "", hash: `#dashboard_session=${token}` },
    sessionStorage, parent: null, addEventListener() {}, setInterval() {}, matchMedia() { return { matches: false }; },
  };
  window.parent = window;
  const closing = script.lastIndexOf("})();");
  const instrumented = `${script.slice(0, closing)}return { contactProfileMarkup, profileDraft, profileStorageKey, persistProfileDrafts, profileDisplayName, profileAuthority, ownedContactProfileCommandsEnabled }; })();${script.slice(closing + 5)}`;
  const helpers = new Function("document", "window", "fetch", "history", `return (${instrumented.trim().slice(0, -1)})`)(
    document,
    window,
    async () => ({ ok: true, json: async () => ({ threads: [], freshness: { state: "healthy" } }) }),
    { replaceState() {} },
  );
  return { helpers, storage };
}

const profile = (overrides = {}) => ({
  contact: { id: "contact-a", display_name: "Avery Example", ...overrides.contact },
  ownedContactProfileAuthority: {
    state: "ready",
    allowedActions: ["revise_name"],
    name: { firstName: "Avery", lastName: "Example", displayName: "Avery Example", authority: "provider_mirror", revision: 0 },
    ...overrides.authority,
  },
});

describe("Client Desk name profile controls", () => {
  it("renders the name-only editor beside the selected name without claiming a GHL update", () => {
    const { helpers } = browserHarness();
    const rendered = helpers.contactProfileMarkup(profile());

    expect(helpers.ownedContactProfileCommandsEnabled).toBe(true);
    expect(rendered).toContain('id="contact-profile-edit"');
    expect(rendered).toContain("Imported name · revision 0");
    expect(rendered).toContain("Avery Example");
    expect(rendered).not.toContain("set_email");
    expect(rendered).not.toContain("set_phone");

    const draft = helpers.profileDraft("contact-a", helpers.profileAuthority(profile()));
    draft.editing = true;
    draft.firstName = "Avery";
    draft.lastName = "Amari";
    draft.dirty = true;
    const editing = helpers.contactProfileMarkup(profile());
    expect(editing).toContain('id="contact-profile-first-name"');
    expect(editing).toContain("Preview: Avery Amari");
    expect(editing).toContain("This changes the Amari CRM name only. It does not update GHL.");
  });

  it("fails closed when the authenticated profile authority is absent or schema-gated unavailable", () => {
    const { helpers } = browserHarness();
    const unavailable = profile({ authority: { state: "unavailable", allowedActions: [], name: null } });
    const rendered = helpers.contactProfileMarkup(unavailable);

    expect(rendered).toContain("Name editing is unavailable");
    expect(rendered).not.toContain('id="contact-profile-edit"');
    expect(rendered).not.toContain('id="owned-contact-profile-form"');
  });

  it("preserves actor-scoped drafts and exact pending payloads across iframe renewal", () => {
    const storage = new Map();
    const first = browserHarness("Eben", storage);
    const authority = first.helpers.profileAuthority(profile());
    const draft = first.helpers.profileDraft("contact-a", authority);
    draft.editing = true;
    draft.firstName = "Avery";
    draft.lastName = "Renewed";
    draft.command = {
      actor: "Eben",
      payload: {
        action: "revise_name", contactId: "contact-a", expectedRevision: 0,
        firstName: "Avery", lastName: "Renewed", idempotencyKey: "client-desk-profile-revise-name-fixture",
      },
    };
    // The production flow persists before sending; use its exact storage path.
    expect(first.helpers.persistProfileDrafts()).toBe(true);

    const renewed = browserHarness("Eben", storage);
    const resumed = renewed.helpers.profileDraft("contact-a", renewed.helpers.profileAuthority(profile()));
    expect(resumed.command).toEqual(draft.command);
    expect(resumed.firstName).toBe("Avery");
    expect(resumed.lastName).toBe("Renewed");

    const anotherActor = browserHarness("Garrett", storage);
    expect(anotherActor.helpers.profileDraft("contact-a", anotherActor.helpers.profileAuthority(profile())).command).toBeNull();
  });

  it("enables the exact pending command retry when authority, session, and storage are ready", () => {
    const { helpers } = browserHarness();
    const authority = helpers.profileAuthority(profile());
    const draft = helpers.profileDraft("contact-a", authority);
    draft.editing = true;
    draft.firstName = "Avery";
    draft.lastName = "Retry";
    draft.command = {
      actor: "Eben",
      payload: {
        action: "revise_name", contactId: "contact-a", expectedRevision: 0,
        firstName: "Avery", lastName: "Retry", idempotencyKey: "client-desk-profile-revise-name-retry-fixture",
      },
    };

    const rendered = helpers.contactProfileMarkup(profile());
    expect(rendered).toContain('type="submit" id="contact-profile-save">Retry save</button>');
    expect(rendered).toContain('id="contact-profile-cancel" disabled');
  });

  it("refreshes a pristine draft but preserves a dirty draft's original revision and proposal", () => {
    const pristine = browserHarness().helpers;
    const original = profile();
    const current = profile({ contact: { display_name: "Avery Current" }, authority: {
      name: { firstName: "Avery", lastName: "Current", displayName: "Avery Current", authority: "owned", revision: 2 },
    } });
    const pristineDraft = pristine.profileDraft("contact-a", pristine.profileAuthority(original));
    pristineDraft.editing = true;
    const refreshedPristine = pristine.profileDraft("contact-a", pristine.profileAuthority(current));
    expect(refreshedPristine).toMatchObject({ firstName: "Avery", lastName: "Current", baseRevision: 2, dirty: false });

    const dirty = browserHarness().helpers;
    const dirtyDraft = dirty.profileDraft("contact-a", dirty.profileAuthority(original));
    dirtyDraft.editing = true;
    dirtyDraft.lastName = "Proposal";
    dirtyDraft.dirty = true;
    const retained = dirty.profileDraft("contact-a", dirty.profileAuthority(current));
    expect(retained).toMatchObject({ firstName: "Avery", lastName: "Proposal", baseRevision: 0, dirty: true });
  });

  it("shows a definite stale conflict as current versus proposed and requires a fresh explicit retry", () => {
    const { helpers } = browserHarness();
    const authority = helpers.profileAuthority(profile({ authority: {
      name: { firstName: "Avery", lastName: "Current", displayName: "Avery Current", authority: "owned", revision: 2 },
    } }));
    const draft = helpers.profileDraft("contact-a", authority);
    draft.editing = true;
    draft.firstName = "Avery";
    draft.lastName = "Proposed";
    draft.conflict = {
      current: authority.name,
      proposed: { firstName: "Avery", lastName: "Proposed" },
    };
    const rendered = helpers.contactProfileMarkup(profile({ authority: { name: authority.name } }));
    expect(rendered).toContain("Current: Avery Current · revision 2");
    expect(rendered).toContain("Proposed: Avery Proposed");
    expect(rendered).toContain('id="contact-profile-conflict-retry"');
    expect(rendered).toContain("Retry with current revision");
  });
});
