import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(path, "utf8");

const landings = {
  "elbow-study.html": "tennis-elbow",
  "jaw-study.html": "tmj",
  "hand-study.html": "hand",
  "foot-study.html": "runners-lower-leg",
  "shoulder-study.html": "desk-shoulders",
};

const qualificationSets = {
  "tennis-elbow": [
    "I've had this pain for more than two weeks.",
    "I can come to our San Francisco office at 662 8th Ave for three visits.",
  ],
  tmj: [
    "I've had this pain for more than two weeks.",
    "I can come to our San Francisco office at 662 8th Ave for three visits.",
  ],
  hand: [
    "I've had this pain for more than two weeks.",
    "It flares mid-session or with gripping, not a fresh sprain.",
    "I can come to our San Francisco office at 662 8th Ave for three visits.",
  ],
  "runners-lower-leg": [
    "I've had this pain for more than two weeks.",
    "I can come to our San Francisco office at 662 8th Ave for three visits.",
  ],
  "desk-shoulders": [
    "I've had this pain for more than two weeks.",
    "It flares after a day at the screen, not a fresh injury.",
    "I can come to our San Francisco office at 662 8th Ave for three visits.",
  ],
};

const studyAnchors = {
  "tennis-elbow": '"tennis-elbow": {',
  tmj: "    tmj: {",
  hand: "    hand: {",
  "runners-lower-leg": '"runners-lower-leg": {',
  "desk-shoulders": '"desk-shoulders": {',
};

describe("single-entry study page contract", () => {
  it("keeps every public source file byte-identical to the committed dist file", () => {
    expect(read("book/study.html")).toBe(read("dist/book/study.html"));
    expect(read("js/study-book.js")).toBe(read("dist/js/study-book.js"));
    expect(read("_headers")).toBe(read("dist/_headers"));
    for (const path of Object.keys(landings)) {
      expect(read(path)).toBe(read("dist/" + path));
    }
  });

  it("routes all five study pages to one slug-specific canonical calendar with no legacy POST", () => {
    for (const [path, slug] of Object.entries(landings)) {
      const html = read(path);
      expect(html).toContain('/book/study?study=' + slug);
      expect(html).not.toContain("signupForm");
      expect(html).not.toMatch(/fetch\(['"]\/api\/.*study-signup/);
      expect(html).not.toContain("ghl-calendar");
      expect(html).not.toContain("iframe");
    }
  });

  it("keeps an accessible five-study chooser only for a missing or invalid slug", () => {
    const html = read("book/study.html");
    for (const slug of Object.values(landings)) {
      expect(html).toContain('value="' + slug + '"');
    }
    expect(html).toContain('id="studyChooser" hidden');
    expect(html).toContain('id="studySelect"');
    expect(html).toContain('id="studyError" role="alert" aria-live="assertive"');
    expect(html).toContain('id="lockedStudy" role="status" aria-live="polite" hidden');
    expect(html).toContain('id="lockedStudyName"');
    expect(html).toContain('src="/js/study-book.js?v=3"');
    expect(html).toContain("You can use my first name and results in the published case series.");
    expect(html).toContain("https://www.clarity.ms/tag/");
    expect(html).not.toContain("I consent to participate");
    expect(html).toContain('id="bookingInitFallback" role="status"');
    expect(read("js/study-book.js")).toContain("elements.initFallback.hidden = true");
  });

  it("preselects and locks every valid deep-link study while missing and invalid slugs use the chooser", () => {
    const javascript = read("js/study-book.js");
    const chooser = javascript.slice(
      javascript.indexOf("function showStudyChooser(message)"),
      javascript.indexOf("function activateStudy(slug, options = {})"),
    );
    const activate = javascript.slice(
      javascript.indexOf("function activateStudy(slug, options = {})"),
      javascript.indexOf("async function loadMonth()"),
    );
    const initialization = javascript.slice(javascript.lastIndexOf("const requestedSlug"));

    expect(activate).toContain("if (!STUDIES[slug]) return false");
    expect(activate).toContain("elements.studySelect.value = slug");
    expect(activate).toContain("elements.studySelect.disabled = true");
    expect(activate).toContain("elements.studyChooser.hidden = true");
    expect(activate).toContain("elements.lockedStudy.hidden = false");
    expect(activate).toContain("renderStudyFields()");
    expect(javascript).toContain("elements.lockedStudyName.textContent = study.name");
    expect(activate).toContain("if (options.focus) focusQualification()");
    expect(activate).not.toContain("loadMonth()");
    expect(chooser).toContain("elements.studySelect.disabled = false");
    expect(chooser).toContain("elements.studyChooser.hidden = false");
    expect(chooser).toContain("elements.lockedStudy.hidden = true");
    expect(chooser).toContain('elements.studyError.textContent = message || ""');
    expect(chooser).toContain("if (message)");
    expect(initialization).toContain("if (STUDIES[requestedSlug])");
    expect(initialization).toContain("activateStudy(requestedSlug)");
    expect(initialization).not.toContain("focusQualification()");
    expect(javascript).toContain("activateStudy(slug, { focus: true })");
    expect(initialization).toContain("showStudyChooser(requestedSlug");
    expect(initialization).toContain('? "That study is not currently open.');
    expect(initialization).not.toContain("dispatchEvent");
  });

  it("requires affirmative qualification before revealing or loading calendar availability", () => {
    const html = read("book/study.html");
    const javascript = read("js/study-book.js");
    const gate = javascript.slice(
      javascript.indexOf('elements.continueButton.addEventListener("click"'),
      javascript.indexOf('elements.back.addEventListener("click"'),
    );
    const qualificationChange = javascript.slice(
      javascript.indexOf('elements.qualifications.addEventListener("change"'),
      javascript.indexOf('elements.calPrev.addEventListener("click"'),
    );
    const reset = javascript.slice(
      javascript.indexOf("function resetCalendarState()"),
      javascript.indexOf("function focusQualification()"),
    );

    expect(html.indexOf('id="qualificationPanel"')).toBeLessThan(html.indexOf('id="calendarBlock"'));
    expect(html).toContain('id="calendarBlock" hidden');
    expect(html).toContain('id="qualificationHeading" tabindex="-1"');
    expect(html).toContain('<fieldset class="screen" aria-describedby="qualificationError">');
    expect(html).toContain('id="step2Heading" tabindex="-1"');
    expect(html).toContain('id="slotLoading" role="status" aria-live="polite"');
    expect(html).toContain('id="slotEmpty" role="status" aria-live="polite" hidden');
    expect(gate).toContain("if (!qualificationsComplete())");
    expect(gate).toContain("loadMonth()");
    expect(gate.indexOf("if (!qualificationsComplete())")).toBeLessThan(
      gate.indexOf("elements.calendarBlock.hidden = false"),
    );
    expect(gate.indexOf("elements.calendarBlock.hidden = false")).toBeLessThan(
      gate.indexOf("loadMonth()"),
    );
    expect(gate).toContain('"[data-qualification]:not(:checked)"');
    expect(gate).toContain("firstUnchecked.focus()");
    expect(qualificationChange).toContain("if (state.calendarUnlocked && !complete) resetCalendarState()");
    expect(reset).toContain("state.selectedSlot = null");
    expect(reset).toContain("state.idempotencyKey = null");
    expect(reset).toContain("state.submittedPayload = null");
    expect(reset).toContain("elements.calendarBlock.hidden = true");
    expect(javascript.slice(javascript.lastIndexOf("const requestedSlug"))).not.toContain("loadMonth()");
    expect(javascript).not.toContain("Continue to qualification");
  });

  it("retains an immutable same-key payload after submission and locks effecting fields once reserved", () => {
    const javascript = read("js/study-book.js");
    expect(javascript).toContain("window.crypto.randomUUID");
    expect(javascript).toContain('const API = "/api/study-book-v2"');
    expect(javascript).toContain("state.submittedPayload");
    expect(javascript).toContain("state.operationLocked");
    expect(javascript).toContain("JSON.stringify(state.submittedPayload)");
    expect(javascript).toContain("lockEffectingFields()");
    expect(javascript).toContain('elements.calendarBlock.querySelectorAll("button")');
    expect(javascript).toContain("Your time is reserved");
    expect(javascript).toContain("Finish enrollment");
    expect(javascript).toContain("Do not book another time");
    expect(javascript).toContain("The booking response was interrupted.");
    expect(javascript).toContain("lockForSameKey(");
    expect(javascript).toContain("if (body.retrySameKey && !body.manualReview)");
    expect(javascript).toContain("state.idempotencyKey = newIdempotencyKey()");
  });

  it("locks all five exact study prompts and ordered qualification sets across server and browser", () => {
    const registry = read("functions/lib/studies.js");
    const server = read("functions/lib/study-booking.js");
    const browser = read("js/study-book.js");
    for (const prompt of [
      "Which arm?",
      "Which side?",
      "Which hand?",
      "Which foot?",
      "Which shoulder?",
    ]) {
      expect(registry).toContain(prompt);
      expect(browser).toContain(prompt);
    }

    const slugs = Object.keys(qualificationSets);
    for (const [index, slug] of slugs.entries()) {
      const start = browser.indexOf(studyAnchors[slug]);
      const next = index + 1 < slugs.length
        ? browser.indexOf(studyAnchors[slugs[index + 1]], start + 1)
        : browser.indexOf("\n  };", start);
      const studyBlock = browser.slice(start, next);
      let prior = -1;
      for (const qualification of qualificationSets[slug]) {
        expect(server).toContain(qualification);
        const position = studyBlock.indexOf(qualification);
        expect(position).toBeGreaterThan(prior);
        prior = position;
      }
      expect((studyBlock.match(/text: "/g) || []).length)
        .toBe(qualificationSets[slug].length);
    }
  });

  it("emits study no-store rules into dist through the normal build contract", () => {
    const headers = read("_headers");
    for (const path of [
      "/elbow-study",
      "/jaw-study",
      "/hand-study",
      "/foot-study",
      "/shoulder-study",
      "/book/study",
      "/js/study-book.js",
      "/api/study-book",
      "/api/study-book-v2",
    ]) {
      expect(headers).toContain(path);
    }
    expect(read("package.json")).toContain("staff-sw.js _headers dist/");
  });

  it("allows the protected CRM Worker only as a Staff iframe source", () => {
    const headers = read("_headers");
    expect(headers).toContain("frame-src https://link.amarimethod.com https://amarimethodfollowup.amarimethod.com https://amari-crm-mirror.eben-fa2.workers.dev");
    expect(read("dist/_headers")).toBe(headers);
  });

  it("gates participant tags behind a provider-read control marker and isolates one exact preview", () => {
    const endpoint = read("functions/api/study-book-v2.js");
    const marker = read("functions/lib/study-enrollment-marker.js");
    const runtime = read("functions/lib/study-booking-runtime.js");
    const markerCall = endpoint.indexOf("await ensureStudyBookingConfirmedMarker");
    const participantCall = endpoint.indexOf("await applyTagDelta(runtime.providerContext");

    expect(markerCall).toBeGreaterThan(-1);
    expect(participantCall).toBeGreaterThan(markerCall);
    expect(marker).toContain('"study-booking-confirmed-before-enrollment"');
    expect(marker).toContain("contactHasStudyBookingConfirmedMarker");
    expect(runtime).toContain("STUDY_BOOKING_PREVIEW_ORIGIN");
    expect(runtime).toContain("urlOrigin === previewOrigin");
    expect(runtime).toContain("requestOrigin === route.previewOrigin");
    expect(runtime).toContain("STUDY_PREVIEW_ATTEND_DB");
    expect(runtime).toContain("STUDY_PREVIEW_RATE_LIMIT_KV");
    expect(runtime).toContain("STUDY_PREVIEW_EVIDENCE_KV");
    expect(runtime).toContain('requirePreviewBinding(context.env, "GHL_API_KEY")');
    expect(runtime).not.toContain("STUDY_PREVIEW_GHL_API_KEY");
    expect(runtime).toContain("STUDY_PREVIEW_FIXTURE_CONTACT_ID");
    expect(runtime).toContain("env: Object.freeze({ GHL_API_KEY: apiKey })");
    expect(runtime).not.toContain("*.pages.dev");
  });

  it("uses a versioned mutation route and leaves the old study-book POST as a non-mutating rollback guard", () => {
    const browser = read("js/study-book.js");
    const compatibility = read("functions/api/study-book.js");
    const v2 = read("functions/api/study-book-v2.js");

    expect(browser).toContain('const API = "/api/study-book-v2"');
    expect(compatibility).toContain('from "./study-book-v2.js"');
    expect(compatibility).toContain("refreshRequired: true");
    expect(compatibility).not.toContain("ghlFetch");
    expect(v2).toContain("checkpointBookingCreateAttempt");
    expect(v2).toContain("hasMatchingCreateAttempt");
  });

  it("keeps legacy endpoint history but cuts off cached-page mutation before GHL", () => {
    for (const path of [
      "functions/api/elbow-study-signup.js",
      "functions/api/jaw-study-signup.js",
      "functions/api/hand-study-signup.js",
      "functions/api/foot-study-signup.js",
      "functions/api/shoulder-study-signup.js",
    ]) {
      const source = read(path);
      expect(source).toContain("legacyStudySignupDisabledResponse");
      expect(source.indexOf("return legacyStudySignupDisabledResponse"))
        .toBeLessThan(source.indexOf("ghlFetch(", source.indexOf("onRequestPost")));
    }
  });
});
