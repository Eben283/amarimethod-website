import { createMediaFolder, listStaffMedia, mediaObjectKey, normalizeMediaName, registerMediaAsset } from "./staff-media.js";

// This is deliberately an allowlist, not a filesystem or URL crawler. It mirrors
// the image files presently referenced by the public site, so Staff can keep a
// private working copy without granting an import endpoint arbitrary fetch access.
const SITE_ASSETS = [
  ["Brand", "/images/identity/amari-method-wordmark.svg"],
  ["Brand", "/images/AmariLogo.avif"],
  ["Brand", "/images/AmariLogo.jpg"],
  ["Brand", "/images/amari-icon.png"],
  ["Brand", "/images/amari-method-logo-1200.png"],
  ["Brand", "/images/amari-method-logo-1200x300.png"],
  ["Brand", "/images/v6/logo-icon.png"],
  ["Brand", "/images/v6/real/amari-icon.png"],
  ["Brand", "/images/v6/real/amari-method-logo-1200x300.png"],
  ["Site photography", "/images/Dr-Garrett-Headshot-2.avif"],
  ["Site photography", "/images/Justin.webp"], ["Site photography", "/images/Maria.webp"], ["Site photography", "/images/Sarah.webp"],
  ["Site photography", "/images/amy-testimonial.webp"], ["Site photography", "/images/dan-testimonial.webp"], ["Site photography", "/images/danielle-testimonial.avif"],
  ["Site photography", "/images/foam-roller-v3.webp"], ["Site photography", "/images/gregg-testimonial.jpg"], ["Site photography", "/images/gymnastic-rings.webp"],
  ["Site photography", "/images/kate-testimonial.avif"], ["Site photography", "/images/nina-testimonial.jpg"], ["Site photography", "/images/pull-up-bar.webp"],
  ["Site photography", "/images/samantha-testimonial.avif"], ["Site photography", "/images/terri-testimonial.jpg"], ["Site photography", "/images/tyler-testimonial.jpg"], ["Site photography", "/images/yoga-block.webp"],
  ["Current site photography", "/images/photos/amari-method-concept-explanation-athletic-client.png"], ["Current site photography", "/images/photos/amari-method-guided-forearm-position-athletic-client.png"],
  ["Current site photography", "/images/photos/amari-method-guided-hand-position-athletic-client.png"], ["Current site photography", "/images/photos/amari-method-guided-jaw-position-athletic-client.png"],
  ["Current site photography", "/images/photos/amari-method-power-posture-athletic-client.png"], ["Current site photography", "/images/photos/amari-method-sf-hillside-athletic-lifestyle.png"],
  ["Current site photography", "/images/photos/amari-method-shoulder-athletic-client.jpeg"], ["Current site photography", "/images/photos/amari-method-suspension-squat-athletic-client.png"],
  ["Current site photography", "/images/photos/black-man42-room-roller.jpg"], ["Current site photography", "/images/photos/black-woman38-window-seat.jpg"], ["Current site photography", "/images/photos/chronic-pain-woman-asn61.jpg"],
  ["Current site photography", "/images/photos/condition-base/knee-refined.jpg"], ["Current site photography", "/images/photos/condition-base/lower-back-refined.jpg"], ["Current site photography", "/images/photos/condition-base/lowerback-hands-support.jpg"],
  ["Current site photography", "/images/photos/condition-base/neck.jpg"], ["Current site photography", "/images/photos/condition-base/shoulder-refined.jpg"], ["Current site photography", "/images/photos/condition-base/shoulder.jpg"],
  ["Current site photography", "/images/photos/conditions-hub-man-blk49.jpg"], ["Current site photography", "/images/photos/detail-crops/hand-reaching-open.jpg"], ["Current site photography", "/images/photos/detail-crops/shoulder-forearm-gym.jpg"],
  ["Current site photography", "/images/photos/firstvisit-doorway-woman-wht48.jpg"], ["Current site photography", "/images/photos/hero-home-cedar-woman.jpg"], ["Current site photography", "/images/photos/hip-woman-wht60-doorway.jpg"],
  ["Current site photography", "/images/photos/hip-woman-wht60.jpg"], ["Current site photography", "/images/photos/inperson-logistics-woman-wht45.jpg"], ["Current site photography", "/images/photos/jh-myofascial.jpg"],
  ["Current site photography", "/images/photos/jh-psoas.jpg"], ["Current site photography", "/images/photos/jh-stretching.jpg"], ["Current site photography", "/images/photos/journal-base/jh-spinal-wave-refined.jpg"],
  ["Current site photography", "/images/photos/journal-base/jh-spinal-wave.jpg"], ["Current site photography", "/images/photos/journal-base/jh-spring-step.jpg"], ["Current site photography", "/images/photos/journal-base/jh-vertical-drop.jpg"],
  ["Current site photography", "/images/photos/knee-man-his44-window.jpg"], ["Current site photography", "/images/photos/knee-man-his44.jpg"], ["Current site photography", "/images/photos/living-practice-woman-asn35.jpg"],
  ["Current site photography", "/images/photos/materials/hand-cedar-grain.jpg"], ["Current site photography", "/images/photos/materials/hand-handrail-grip.jpg"], ["Current site photography", "/images/photos/materials/jaw-neck-soft.jpg"],
  ["Current site photography", "/images/photos/materials/wood-floor-grain.jpg"], ["Current site photography", "/images/photos/neck-man-asn47.jpg"], ["Current site photography", "/images/photos/partner-coach.jpg"],
  ["Current site photography", "/images/photos/partner-movement-man-his52.jpg"], ["Current site photography", "/images/photos/partner-trainer.jpg"], ["Current site photography", "/images/photos/partner-woman-his41.jpg"],
  ["Current site photography", "/images/photos/partner-yoga-woman-wht38.jpg"], ["Current site photography", "/images/photos/plantar-woman-multi41.jpg"], ["Current site photography", "/images/photos/sciatica-man-wht50.jpg"], ["Current site photography", "/images/photos/tmj-woman-asn39.jpg"],
  ["Study materials", "/images/study-flyers-textable/Elbow-Pain-Study-Golfers.png"], ["Study materials", "/images/study-flyers-textable/Elbow-Pain-Study-Lifters.png"],
  ["Study materials", "/images/study-flyers-textable/Elbow-Pain-Study-Tennis-Pickleball.png"], ["Study materials", "/images/study-flyers-textable/Foot-Pain-On-Feet.png"],
  ["Study materials", "/images/study-flyers-textable/Foot-Pain-Runners.png"], ["Study materials", "/images/study-flyers-textable/Hand-Pain-Study-Climbers.png"],
  ["Study materials", "/images/study-flyers-textable/Jaw-Tension-Grinders.png"], ["Study materials", "/images/study-flyers-textable/Jaw-Tension-TMJ.png"], ["Study materials", "/images/study-flyers-textable/Shoulder-Upper-Back-Pain-Study-Coworking.png"],
  ["Legacy site imagery", "/images/v6/amari-cutout-journal.png"], ["Legacy site imagery", "/images/v6/amari-cutout-living.png"], ["Legacy site imagery", "/images/v6/amari-cutout-partner.png"], ["Legacy site imagery", "/images/v6/amari-cutout-pricing.png"],
  ["Legacy site imagery", "/images/v6/real/Amari-child.jpg"], ["Legacy site imagery", "/images/v6/real/active-bridge.jpg"], ["Legacy site imagery", "/images/v6/real/back-pain-from-sitting.webp"], ["Legacy site imagery", "/images/v6/real/danielle-testimonial.jpg"],
  ["Legacy site imagery", "/images/v6/real/elbow-reset.jpg"], ["Legacy site imagery", "/images/v6/real/foam-roller-v2.jpg"], ["Legacy site imagery", "/images/v6/real/garrett-face-1200.jpg"], ["Legacy site imagery", "/images/v6/real/garrett-session-img-3348.jpg"],
  ["Legacy site imagery", "/images/v6/real/gymnastic-rings.jpg"], ["Legacy site imagery", "/images/v6/real/hand-balancer.jpg"], ["Legacy site imagery", "/images/v6/real/jaw-align.jpg"], ["Legacy site imagery", "/images/v6/real/passive-bridge.jpg"],
  ["Legacy site imagery", "/images/v6/real/power-posture.jpg"], ["Legacy site imagery", "/images/v6/real/pull-up-bar.jpg"], ["Legacy site imagery", "/images/v6/real/putting-it-all-together.jpg"], ["Legacy site imagery", "/images/v6/real/spring-step.jpg"],
];

const MIME_BY_EXTENSION = {
  avif: "image/avif", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml", webp: "image/webp",
};
const ROOT_FOLDER = "Amari site assets";
const CHUNK_SIZE = 8;

function extensionFor(path) {
  return path.split(".").pop()?.toLowerCase() || "";
}

function displayName(path) {
  return decodeURIComponent(path.split("/").pop() || "site-asset");
}

async function ensureFolder(db, folders, name, parentId, actor) {
  const existing = folders.find((folder) => folder.status === "active" && folder.parentId === parentId && folder.name === name);
  if (existing) return existing;
  const folder = await createMediaFolder(db, { action: "create_folder", name, parentId }, { actor });
  folders.push(folder);
  return folder;
}

export function siteAssetTotal() {
  return SITE_ASSETS.length;
}

export async function importSiteMediaBatch({ db, bucket, origin, actor, offset = 0, fetcher = fetch }) {
  if (!db || !bucket) throw Object.assign(new Error("Media upload storage is not configured"), { status: 422 });
  const start = Math.max(0, Number.parseInt(offset, 10) || 0);
  const group = SITE_ASSETS.slice(start, start + CHUNK_SIZE);
  const library = await listStaffMedia(db);
  const root = await ensureFolder(db, library.folders, ROOT_FOLDER, null, actor);
  const folders = new Map();
  for (const [folderName] of group) {
    if (!folders.has(folderName)) folders.set(folderName, await ensureFolder(db, library.folders, folderName, root.id, actor));
  }
  const known = new Set(library.assets.filter((asset) => asset.status === "active").map((asset) => `${asset.folderId}:${normalizeMediaName(asset.name)}`));
  const result = { imported: [], skipped: [], failed: [], total: SITE_ASSETS.length, nextOffset: Math.min(start + group.length, SITE_ASSETS.length) };

  for (const [folderName, path] of group) {
    const folder = folders.get(folderName);
    const name = displayName(path);
    const key = `${folder.id}:${normalizeMediaName(name)}`;
    if (known.has(key)) { result.skipped.push(name); continue; }
    const mimeType = MIME_BY_EXTENSION[extensionFor(path)];
    if (!mimeType) { result.failed.push({ name, error: "Unsupported source file type" }); continue; }
    try {
      const response = await fetcher(new URL(path, origin).toString());
      if (!response.ok) throw new Error(`Source returned ${response.status}`);
      const bytes = await response.arrayBuffer();
      const assetId = crypto.randomUUID();
      const objectKey = mediaObjectKey(assetId, mimeType);
      await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { assetId, importedFrom: path, uploadedBy: String(actor || "Staff").slice(0, 80) } });
      try {
        const registered = await registerMediaAsset(db, { name, mimeType, sizeBytes: bytes.byteLength, folderId: folder.id }, { actor, id: assetId, allowSvg: true });
        known.add(key);
        result.imported.push(registered.asset.name);
      } catch (cause) {
        await bucket.delete(objectKey);
        if (Number(cause?.status) === 409) result.skipped.push(name);
        else throw cause;
      }
    } catch (cause) {
      result.failed.push({ name, error: cause instanceof Error ? cause.message : "Import failed" });
    }
  }
  return result;
}
