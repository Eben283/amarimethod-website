import { describe, expect, it } from "vitest";
import { routeAskAmariRequest } from "./ask-amari-router.js";

describe("routeAskAmariRequest", () => {
  it("routes an explicit drafting request through the voice writer", () => {
    expect(routeAskAmariRequest({ message: "Draft a text to Maria after her session" })).toBe("write");
  });

  it("keeps a writing revision in the writer without asking the user to select a mode", () => {
    expect(routeAskAmariRequest({ message: "Make it shorter", previousMode: "write" })).toBe("write");
  });

  it("leaves operational questions with the chief of staff", () => {
    expect(routeAskAmariRequest({ message: "Who is booked this afternoon?" })).toBe("ask");
    expect(routeAskAmariRequest({ message: "Edit Maria's appointment" })).toBe("ask");
    expect(routeAskAmariRequest({ message: "Can I rewrite the appointment reminder workflow?" })).toBe("ask");
    expect(routeAskAmariRequest({ message: "How do I write off a business expense?" })).toBe("ask");
    expect(routeAskAmariRequest({ message: "What did I write to Maria last time?" })).toBe("ask");
    expect(routeAskAmariRequest({ message: "Write a list of who is booked this afternoon" })).toBe("ask");
    expect(routeAskAmariRequest({ message: "Edit Maria's client record" })).toBe("ask");
  });

  it("routes ordinary drafting phrasing through the voice writer", () => {
    expect(routeAskAmariRequest({ message: "Can you make this friendlier: Hey Maria…" })).toBe("write");
    expect(routeAskAmariRequest({ message: "Please text Maria that we need to reschedule" })).toBe("write");
    expect(routeAskAmariRequest({ message: "text maria to confirm tomorrow" })).toBe("write");
  });
});
