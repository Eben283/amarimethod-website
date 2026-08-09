import { describe, expect, it, vi } from "vitest";

vi.mock("./gmail-evidence.js", () => ({
  gmailEvidenceReadModel: vi.fn(),
}));

import { gmailEvidenceReadModel } from "./gmail-evidence.js";
import { gmailReplyReadiness } from "./gmail-reply-readiness.js";

describe("Gmail reply evidence readiness", () => {
  it("returns only the signed actor's bounded checkpoint and review projection", async () => {
    gmailEvidenceReadModel.mockResolvedValue({
      latestHistory: [{ mailbox_actor: "Eben", grant_owner: "eben@amarimethod.com", mailbox_address: "eben@amarimethod.com", history_id: "900719925474099399999", observed_at: "2026-08-09T16:00:00.000Z" }],
      syncGaps: [{ mailbox_actor: "Eben", grant_owner: "eben@amarimethod.com", mailbox_address: "eben@amarimethod.com", provider_message_id: "gmail-message-1", history_id: "900719925474099399998", reason: "provider_message_missing", observed_at: "2026-08-09T15:59:00.000Z" }],
      inboundMessages: [{ body_clean: "must not escape" }],
      providerEvents: [{ failure_detail_clean: "must not escape" }],
    });

    await expect(gmailReplyReadiness({}, { actor: "Eben", limit: 8 })).resolves.toEqual({
      actor: "Eben",
      mailbox: "eben@amarimethod.com",
      state: "review",
      replySyncEnabled: false,
      checkpoint: { historyId: "900719925474099399999", observedAt: "2026-08-09T16:00:00.000Z" },
      syncGaps: [{ messageId: "gmail-message-1", historyId: "900719925474099399998", reason: "provider_message_missing", observedAt: "2026-08-09T15:59:00.000Z" }],
    });
    expect(gmailEvidenceReadModel).toHaveBeenCalledWith({}, {
      mailboxActor: "Eben", grantOwner: "eben@amarimethod.com", limit: 8,
    });
  });

  it("reports an honest dormant baseline state and rejects unknown actors", async () => {
    gmailEvidenceReadModel.mockResolvedValue({ latestHistory: [], syncGaps: [] });
    await expect(gmailReplyReadiness({}, { actor: "Garrett" })).resolves.toMatchObject({
      actor: "Garrett", mailbox: "garrett@amarimethod.com", state: "no_baseline", replySyncEnabled: false,
      checkpoint: null, syncGaps: [],
    });
    await expect(gmailReplyReadiness({}, { actor: "Staff" })).rejects.toMatchObject({ code: "invalid_actor" });
  });
});
