import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
  verifySessionToken: vi.fn(async (token) => token === "staff-token" ? { role: "staff", user: "Garrett" } : { role: "portal" }),
}));

const { listStaffMedia, createMediaFolder, updateMediaAsset, registerMediaAsset, getMediaAssetRecord } = vi.hoisted(() => ({
  listStaffMedia: vi.fn(),
  createMediaFolder: vi.fn(),
  updateMediaAsset: vi.fn(),
  registerMediaAsset: vi.fn(),
  getMediaAssetRecord: vi.fn(),
}));

vi.mock("../lib/staff-media.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, listStaffMedia, createMediaFolder, updateMediaAsset, registerMediaAsset, getMediaAssetRecord };
});

import * as mediaApi from "./staff-media.js";
import * as uploadApi from "./staff-media-upload.js";
import * as fileApi from "./staff-media-file.js";

function request(url, init = {}) {
  return new Request(url, {
    ...init,
    headers: { Authorization: "Bearer staff-token", ...(init.headers || {}) },
  });
}

function context(req, env = {}) {
  return { request: req, env: { JWT_SECRET: "secret", ATTEND_DB: {}, ...env } };
}

describe("Staff Media APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listStaffMedia.mockResolvedValue({ folders: [], assets: [] });
  });

  it("keeps the library staff-authenticated and reports upload readiness honestly", async () => {
    const denied = await mediaApi.onRequestGet(context(new Request("https://www.amarimethod.com/api/staff-media")));
    expect(denied.status).toBe(401);

    const response = await mediaApi.onRequestGet(context(request("https://www.amarimethod.com/api/staff-media")));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ folders: [], assets: [], uploadReady: false, storage: "owned-d1-r2" });
  });

  it("requires both owned metadata and object storage before accepting bytes", async () => {
    const response = await uploadApi.onRequestPost(context(request("https://www.amarimethod.com/api/staff-media-upload", {
      method: "POST",
      headers: { "Content-Type": "image/png", "X-Amari-File-Name": "test.png", "X-Amari-File-Size": "4" },
      body: new Uint8Array([1, 2, 3, 4]),
    })));
    expect(response.status).toBe(422);
    expect(registerMediaAsset).not.toHaveBeenCalled();
  });

  it("streams an approved upload into the private bucket and returns only the internal asset record", async () => {
    const bucket = { put: vi.fn(async () => ({})), delete: vi.fn() };
    registerMediaAsset.mockResolvedValue({ asset: { id: "asset-1", internalUrl: "/staff/media?asset=asset-1" } });
    const response = await uploadApi.onRequestPost(context(request("https://www.amarimethod.com/api/staff-media-upload", {
      method: "POST",
      headers: { "Content-Type": "image/png", "X-Amari-File-Name": "session%20photo.png", "X-Amari-File-Size": "4" },
      body: new Uint8Array([1, 2, 3, 4]),
    }), { MEDIA_BUCKET: bucket }));
    expect(response.status).toBe(201);
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(registerMediaAsset).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: "session photo.png", sizeBytes: 4 }), expect.objectContaining({ actor: "Garrett" }));
    expect(await response.json()).toEqual({ asset: { id: "asset-1", internalUrl: "/staff/media?asset=asset-1" } });
  });

  it("serves private files inline with byte-range support", async () => {
    getMediaAssetRecord.mockResolvedValue({
      public: { id: "asset-1", name: "movement.mp4", mimeType: "video/mp4", sizeBytes: 8 },
      objectKey: "staff-media/asset-1.mp4",
    });
    const bucket = {
      get: vi.fn(async () => ({ body: new Uint8Array([3, 4, 5]), etag: "etag-1" })),
      head: vi.fn(),
    };
    const response = await fileApi.onRequestGet(context(request("https://www.amarimethod.com/api/staff-media-file?id=asset-1", {
      headers: { Range: "bytes=2-4" },
    }), { MEDIA_BUCKET: bucket }));
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-4/8");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(bucket.get).toHaveBeenCalledWith("staff-media/asset-1.mp4", { range: { offset: 2, length: 3 } });
  });
});
