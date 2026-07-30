import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRecipients, sendTwilioSms } from "./twilio.js";

describe("parseRecipients", () => {
  it("parses unique E.164 list", () => {
    assert.deepEqual(
      parseRecipients("+14159348341, +14153142790,+14159348341"),
      ["+14159348341", "+14153142790"],
    );
  });

  it("drops junk", () => {
    assert.deepEqual(parseRecipients("4159348341, +1abc"), []);
  });
});

describe("sendTwilioSms", () => {
  it("fails closed without credentials", async () => {
    const r = await sendTwilioSms({}, { to: "+14159348341", body: "hi" });
    assert.equal(r.success, false);
    assert.match(r.error, /missing TWILIO/);
  });

  it("rejects bad destination", async () => {
    const r = await sendTwilioSms(
      { TWILIO_SID: "ACxx", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+18316121965" },
      { to: "4159348341", body: "hi" },
    );
    assert.equal(r.success, false);
    assert.match(r.error, /invalid to/);
  });
});
