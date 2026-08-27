import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMediaFolder, listStaffMedia, mediaObjectKey, normalizeMediaName, registerMediaAsset } = vi.hoisted(() => ({
  createMediaFolder: vi.fn(),
  listStaffMedia: vi.fn(),
  mediaObjectKey: vi.fn(() => "staff-media/new.jpg"),
  normalizeMediaName: vi.fn((value) => String(value).trim().toLowerCase()),
  registerMediaAsset: vi.fn(),
}));

vi.mock("./staff-media.js", () => ({ createMediaFolder, listStaffMedia, mediaObjectKey, normalizeMediaName, registerMediaAsset }));

import { importSiteMediaBatch, syncSiteMediaCatalog } from "./staff-site-media.js";

const root = { id: "root", parentId: null, name: "Amari site assets", status: "active" };
const currentIdentity = { id: "identity", parentId: "root", name: "Current identity", status: "active" };
const legacyWordmark = {
  id: "wordmark", folderId: "identity", name: "amari-method-wordmark.svg", kind: "image", status: "active",
  description: "", websiteUsage: "not_used", curationStatus: "good", sourcePath: null,
};

function metadataDb() {
  return {
    prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
    batch: vi.fn(async () => {}),
  };
}

describe("Staff Media site catalog synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMediaFolder.mockImplementation(async (_db, input) => ({ id: input.name.toLowerCase().replaceAll(" ", "-"), parentId: input.parentId, name: input.name, status: "active" }));
  });

  it("syncs a legacy Current identity asset in place without an R2 upload or new registration", async () => {
    const db = metadataDb();
    listStaffMedia.mockResolvedValue({ folders: [root, currentIdentity], assets: [legacyWordmark] });
    const bucket = { put: vi.fn(), delete: vi.fn() };
    const fetcher = vi.fn(async () => new Response("missing", { status: 404 }));

    const result = await importSiteMediaBatch({ db, bucket, origin: "https://www.amarimethod.com", actor: "Eben", offset: 0, fetcher });

    expect(result.skipped).toContain("amari-method-wordmark.svg");
    expect(db.batch).toHaveBeenCalledOnce();
    expect(bucket.put).not.toHaveBeenCalled();
    expect(registerMediaAsset).not.toHaveBeenCalled();
  });

  it("classifies every active image while excluding PDFs and preserving all stored objects", async () => {
    const db = metadataDb();
    const libraryOnly = { id: "home-practice", folderId: null, name: "home-practice.jpg", kind: "image", status: "active", description: "", websiteUsage: "currently_used", curationStatus: "delete_candidate", sourcePath: null };
    const pdf = { id: "handout", folderId: null, name: "handout.pdf", kind: "document", status: "active", description: "", websiteUsage: "not_used", curationStatus: "good", sourcePath: null };
    listStaffMedia.mockResolvedValue({ folders: [root, currentIdentity], assets: [legacyWordmark, libraryOnly, pdf] });

    const result = await syncSiteMediaCatalog({ db, actor: "Eben" });

    expect(result).toMatchObject({ classified: 2, catalogMatched: 1, defaulted: 1, skippedNonImage: 1 });
    expect(db.batch).toHaveBeenCalledTimes(2);
    expect(registerMediaAsset).not.toHaveBeenCalled();
  });
});
