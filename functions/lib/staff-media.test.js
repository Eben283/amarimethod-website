import { describe, expect, it } from "vitest";
import { mediaObjectKey, normalizeMediaName, registerMediaAsset, updateMediaAsset, validateMediaUpload } from "./staff-media.js";

describe("Staff media domain boundary", () => {
  it("normalizes names and accepts only the intended private-library formats", () => {
    expect(normalizeMediaName("  Session   Notes.PDF ")).toBe("session notes.pdf");
    expect(validateMediaUpload({ name: "shoulder.mov", mimeType: "video/quicktime", sizeBytes: 2048 })).toMatchObject({ kind: "video", mimeType: "video/quicktime" });
    expect(validateMediaUpload({ name: "handout.pdf", mimeType: "application/pdf", sizeBytes: 99 })).toMatchObject({ kind: "document" });
    expect(() => validateMediaUpload({ name: "script.svg", mimeType: "image/svg+xml", sizeBytes: 40 })).toThrow(/JPG/);
    expect(() => validateMediaUpload({ name: "page.html", mimeType: "text/html", sizeBytes: 40 })).toThrow(/JPG/);
  });

  it("rejects empty and oversized objects before storage", () => {
    expect(() => validateMediaUpload({ name: "empty.png", mimeType: "image/png", sizeBytes: 0 })).toThrow(/empty/);
    expect(() => validateMediaUpload({ name: "large.mp4", mimeType: "video/mp4", sizeBytes: 96 * 1024 * 1024 })).toThrow(/95 MB/);
  });

  it("uses opaque object keys instead of user-controlled paths", () => {
    expect(mediaObjectKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "image/png"))
      .toBe("staff-media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png");
  });

  it("stores a private description and explicit website/curation classification", async () => {
    const statements = [];
    const db = {
      prepare(sql) {
        return {
          bind(...values) {
            statements.push({ sql, values });
            return { first: async () => ({ id: "folder-1", status: "active" }) };
          },
        };
      },
      batch: async () => {},
    };
    const result = await registerMediaAsset(db, {
      name: "arrival.jpg", mimeType: "image/jpeg", sizeBytes: 42, folderId: "folder-1",
      description: "Client arriving for an assessment.", websiteUsage: "currently_used",
      curationStatus: "delete_candidate", sourcePath: "/images/arrival.jpg",
    }, { actor: "Eben", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", now: "2026-08-27T00:00:00.000Z" });
    expect(result.asset).toMatchObject({ description: "Client arriving for an assessment.", websiteUsage: "currently_used", curationStatus: "delete_candidate", sourcePath: "/images/arrival.jpg" });
    expect(statements[1].values).toEqual(expect.arrayContaining(["Client arriving for an assessment.", "currently_used", "delete_candidate", "/images/arrival.jpg"]));
  });

  it("updates curation without archiving or deleting the original object", async () => {
    const current = {
      id: "asset-1", folder_id: null, display_name: "old.jpg", normalized_name: "old.jpg", status: "active", version: 3,
      internal_description: "Old note", website_usage: "not_used", curation_status: "good", source_path: null,
      original_name: "old.jpg", object_key: "staff-media/asset-1.jpg", mime_type: "image/jpeg", size_bytes: 42,
      created_at: "2026-08-01T00:00:00.000Z", created_by: "Eben", updated_at: "2026-08-01T00:00:00.000Z", updated_by: "Eben",
    };
    const statements = [];
    const db = {
      prepare(sql) {
        return {
          bind(...values) {
            statements.push({ sql, values });
            return { first: async () => current };
          },
        };
      },
      batch: async () => {},
    };
    const changed = await updateMediaAsset(db, {
      action: "curate_asset", assetId: "asset-1", description: "Not suitable for current client-facing pages.",
      websiteUsage: "currently_used", curationStatus: "delete_candidate", sourcePath: "/images/old.jpg",
    }, { actor: "Eben", now: "2026-08-27T00:00:00.000Z" });
    expect(changed).toMatchObject({ status: "active", description: "Not suitable for current client-facing pages.", websiteUsage: "currently_used", curationStatus: "delete_candidate" });
    expect(statements.some(({ sql }) => /DELETE FROM staff_media_assets/i.test(sql))).toBe(false);
  });
});
