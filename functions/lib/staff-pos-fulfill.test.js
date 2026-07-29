import { describe, expect, it } from "vitest";
import { buildPosFulfillmentEffects, computeFulfillmentFields } from "./staff-pos-fulfill.js";
import { FIELD_IDS } from "./ghl-fields.js";

describe("staff POS fulfillment planning", () => {
  it("sets package balance and ignores custom lines for session credit", () => {
    const effects = buildPosFulfillmentEffects([
      {
        kind: "catalog",
        ghlProductId: "6a66cde7ef7b07f122ad46fb",
        label: "The 12-Week Amari Practice",
        quantity: 1,
        lineTotalCents: 540000,
      },
      {
        kind: "custom",
        ghlProductId: null,
        label: "Gift wrap",
        quantity: 1,
        lineTotalCents: 500,
      },
    ]);
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "set_package", sessions: 24, seriesType: "12-week" }),
      expect.objectContaining({ type: "note", label: "Gift wrap" }),
    ]));

    const plan = computeFulfillmentFields(effects, {
      customFields: [{ id: FIELD_IDS.sessions_remaining, value: "2" }],
    });
    expect(plan.remaining).toBe(24);
    expect(plan.seriesType).toBe("12-week");
    expect(plan.livingPractice).toBe(true);
    expect(plan.packagePurchased).toBe(true);
  });

  it("credits the $3,000 12-week practice the same 24 sessions", () => {
    const effects = buildPosFulfillmentEffects([
      {
        kind: "catalog",
        ghlProductId: "6a66cde7ef7b07f122ad46fb",
        label: "The 12-Week Amari Practice ($3,000)",
        quantity: 1,
        lineTotalCents: 300000,
      },
    ]);
    expect(effects).toEqual([
      expect.objectContaining({ type: "set_package", sessions: 24, seriesType: "12-week" }),
    ]);
  });

  it("adds sessions for an initial and keeps living-practice grants separate", () => {
    const effects = buildPosFulfillmentEffects([
      {
        kind: "catalog",
        ghlProductId: "688a1cd770362828afbf08a2",
        label: "Initial Session — In Person",
        quantity: 1,
        lineTotalCents: 22500,
      },
      {
        kind: "catalog",
        ghlProductId: "6998d7f2606fa79c54fa3ff5",
        label: "Living Practice",
        quantity: 1,
        lineTotalCents: 34700,
      },
    ]);
    const plan = computeFulfillmentFields(effects, {
      customFields: [{ id: FIELD_IDS.sessions_remaining, value: "0" }],
    });
    expect(plan.remaining).toBe(1);
    expect(plan.livingPractice).toBe(true);
    expect(plan.packagePurchased).toBe(false);
  });

  it("records the $29 assessment as a note and never credits a session", () => {
    const effects = buildPosFulfillmentEffects([
      {
        kind: "catalog",
        ghlProductId: "6a66cf0103821ea09ea13f1b",
        label: "Amari Assessment ($29)",
        quantity: 1,
        lineTotalCents: 2900,
      },
    ]);
    expect(effects).toEqual([expect.objectContaining({ type: "note", label: "Amari Assessment" })]);
    const plan = computeFulfillmentFields(effects, {
      customFields: [{ id: FIELD_IDS.sessions_remaining, value: "0" }],
    });
    expect(plan.remaining).toBe(0);
    expect(plan.packagePurchased).toBe(false);
  });

  it("adds for the additive 4→8 upgrade instead of wiping unused balance", () => {
    const effects = buildPosFulfillmentEffects([
      {
        kind: "catalog",
        ghlProductId: "6a010952e41b442c862d3c01",
        label: "Upgrade: 4-Session → 8-Session",
        quantity: 1,
        lineTotalCents: 57500,
      },
    ]);
    expect(effects[0].type).toBe("add_package");
    const plan = computeFulfillmentFields(effects, {
      customFields: [
        { id: FIELD_IDS.sessions_remaining, value: "2" },
        { id: FIELD_IDS.series_type, value: "4-session" },
      ],
    });
    expect(plan.remaining).toBe(6);
    expect(plan.seriesType).toBe("8-session");
  });
});
