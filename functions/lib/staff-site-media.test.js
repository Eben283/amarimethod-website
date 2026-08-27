import { describe, expect, it } from "vitest";
import { siteAssetCatalog, siteAssetTotal } from "./staff-site-media.js";

describe("website image filing list", () => {
  it("gives every known site image one deterministic website-use destination", () => {
    const catalog = siteAssetCatalog();
    expect(catalog).toHaveLength(siteAssetTotal());
    expect(catalog.length).toBeGreaterThan(80);
    for (const asset of catalog) {
      expect(asset).toMatchObject({ folder: expect.any(String), path: expect.stringMatching(/^\/images\//) });
      expect(["currently_used", "not_used"]).toContain(asset.websiteUsage);
    }
  });

  it("reflects the confirmed live exceptions in the website-use list", () => {
    const byPath = new Map(siteAssetCatalog().map((asset) => [asset.path, asset]));
    expect(byPath.get("/images/photos/partner-coach.jpg")).toMatchObject({ websiteUsage: "not_used" });
    expect(byPath.get("/images/photos/amari-method-passive-bridge-south-asian-client.png")).toMatchObject({ websiteUsage: "currently_used" });
  });

  it("keeps phone-share flyers separate from print masters", () => {
    const byPath = new Map(siteAssetCatalog().map((asset) => [asset.path, asset]));
    expect(byPath.get("/images/study-flyers-textable/Jaw-Tension-TMJ.png")).toMatchObject({ folder: "Digital share graphics" });
    expect(byPath.get("/images/study-flyers-textable/Elbow-Pain-Study-Golfers.png")).toMatchObject({ folder: "Digital share graphics" });
  });
});
