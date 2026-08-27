import { describe, expect, it } from "vitest";
import { siteAssetCatalog, siteAssetTotal } from "./staff-site-media.js";

describe("fixed Staff site-media catalog", () => {
  it("gives every importable image a description and explicit classifications", () => {
    const catalog = siteAssetCatalog();
    expect(catalog).toHaveLength(siteAssetTotal());
    expect(catalog.length).toBeGreaterThan(80);
    for (const asset of catalog) {
      expect(asset).toMatchObject({ folder: expect.any(String), path: expect.stringMatching(/^\/images\//), description: expect.any(String) });
      expect(["currently_used", "not_used"]).toContain(asset.websiteUsage);
      expect(["good", "delete_candidate"]).toContain(asset.curationStatus);
    }
  });

  it("preserves the rejected public-placement images as non-destructive delete candidates", () => {
    const byPath = new Map(siteAssetCatalog().map((asset) => [asset.path, asset]));
    for (const path of [
      "/images/photos/black-woman38-window-seat.jpg",
      "/images/photos/black-man42-room-roller.jpg",
      "/images/photos/living-practice-woman-asn35.jpg",
      "/images/photos/firstvisit-doorway-woman-wht48.jpg",
    ]) {
      expect(byPath.get(path)).toMatchObject({ websiteUsage: "currently_used", curationStatus: "delete_candidate" });
    }
  });
});
