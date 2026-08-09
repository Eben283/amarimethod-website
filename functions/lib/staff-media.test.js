import { describe, expect, it } from "vitest";
import { mediaObjectKey, normalizeMediaName, validateMediaUpload } from "./staff-media.js";

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
});
