import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseContactIds, sendGhlSms } from "./ghl-sms.js";

describe("parseContactIds", () => {
  it("parses unique alphanumeric ids", () => {
    assert.deepEqual(
      parseContactIds("3jsTC9Cb7hkDpC3FLuFd, lYgxJtvpRzWO2UvDh9ju,3jsTC9Cb7hkDpC3FLuFd"),
      ["3jsTC9Cb7hkDpC3FLuFd", "lYgxJtvpRzWO2UvDh9ju"],
    );
  });

  it("drops junk", () => {
    assert.deepEqual(parseContactIds("+14159348341, bad id!"), []);
  });
});

describe("sendGhlSms", () => {
  it("rejects invalid contactId without calling network", async () => {
    const r = await sendGhlSms({}, { contactId: "bad id", message: "hi" });
    assert.equal(r.success, false);
    assert.match(r.error, /invalid contactId/);
  });

  it("rejects empty message", async () => {
    const r = await sendGhlSms({}, { contactId: "abc123", message: "  " });
    assert.equal(r.success, false);
    assert.match(r.error, /empty message/);
  });
});
