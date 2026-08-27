import { createMediaFolder, listStaffMedia, mediaObjectKey, normalizeMediaName, registerMediaAsset } from "./staff-media.js";

// This is deliberately an allowlist, not a filesystem or URL crawler. It mirrors
// the image files presently referenced by the public site, so Staff can keep a
// private working copy without granting an import endpoint arbitrary fetch access.
const RAW_SITE_ASSETS = [
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
  ["Current site photography", "/images/photos/amari-method-active-bridge-ocean-swimmer.png"], ["Current site photography", "/images/photos/amari-method-concept-explanation-athletic-client.png"], ["Current site photography", "/images/photos/amari-method-elbow-reset-athletic-ceo.png"], ["Current site photography", "/images/photos/amari-method-guided-forearm-position-athletic-client.png"],
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
  ["Legacy site imagery", "/images/v6/real/pull-up-bar.jpg"], ["Legacy site imagery", "/images/v6/real/putting-it-all-together.jpg"], ["Legacy site imagery", "/images/v6/real/spring-step.jpg"],
];

// Every fixed site asset has a private, editable record in Staff Media. The
// import is intentionally explicit rather than a file-system crawl: these are
// the assets that have been reviewed as part of the website inventory.
const NOT_CURRENTLY_USED = new Set([
  "/images/AmariLogo.jpg", "/images/amari-icon.png", "/images/amari-method-logo-1200.png", "/images/amari-method-logo-1200x300.png", "/images/v6/logo-icon.png", "/images/v6/real/amari-icon.png", "/images/v6/real/amari-method-logo-1200x300.png", "/images/Dr-Garrett-Headshot-2.avif",
  "/images/photos/amari-method-active-bridge-ocean-swimmer.png", "/images/photos/amari-method-concept-explanation-athletic-client.png", "/images/photos/amari-method-guided-hand-position-athletic-client.png", "/images/photos/amari-method-sf-hillside-athletic-lifestyle.png", "/images/photos/amari-method-shoulder-athletic-client.jpeg", "/images/photos/amari-method-suspension-squat-athletic-client.png",
  "/images/photos/condition-base/neck.jpg", "/images/photos/detail-crops/hand-reaching-open.jpg", "/images/photos/jh-myofascial.jpg", "/images/photos/jh-psoas.jpg", "/images/photos/jh-stretching.jpg", "/images/photos/materials/hand-handrail-grip.jpg",
  "/images/v6/real/foam-roller-v2.jpg", "/images/v6/real/garrett-session-img-3348.jpg", "/images/v6/real/gymnastic-rings.jpg", "/images/v6/real/jaw-align.jpg",
]);

// These are deliberately *not* deleted. Eben has rejected them for the public
// placements currently using them; the record remains searchable and the
// original is preserved until an owner makes a separate deletion decision.
const DELETE_CANDIDATES = new Set([
  "/images/photos/black-woman38-window-seat.jpg",
  "/images/photos/black-man42-room-roller.jpg",
  "/images/photos/living-practice-woman-asn35.jpg",
  "/images/photos/firstvisit-doorway-woman-wht48.jpg",
]);

const DESCRIPTIONS = {
  "/images/photos/black-woman38-window-seat.jpg": "Seated woman by a window in the Amari room; currently used for the homepage method panel.",
  "/images/photos/black-man42-room-roller.jpg": "Man standing in the Amari room near a foam roller; currently used as the How It Works hero.",
  "/images/photos/living-practice-woman-asn35.jpg": "Woman doing a seated arm movement in the Amari room; currently used for Living Practice.",
  "/images/photos/firstvisit-doorway-woman-wht48.jpg": "Woman entering through the Amari doorway; currently used for First Visit and the homepage assessment panel.",
};

function internalDescription(path) {
  if (DESCRIPTIONS[path]) return DESCRIPTIONS[path];
  const label = displayName(path).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  return `Amari website asset: ${label}. Review its preview in Staff before assigning it to a new placement.`;
}

export const SITE_ASSETS = Object.freeze(RAW_SITE_ASSETS.map(([folder, path]) => Object.freeze({
  folder,
  path,
  description: internalDescription(path),
  websiteUsage: NOT_CURRENTLY_USED.has(path) ? "not_used" : "currently_used",
  curationStatus: DELETE_CANDIDATES.has(path) ? "delete_candidate" : "good",
})));

const MIME_BY_EXTENSION = {
  avif: "image/avif", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml", webp: "image/webp",
};
const ROOT_FOLDER = "Amari site assets";
const CHUNK_SIZE = 8;
const FOLDER_ALIASES = {
  Brand: ["Brand", "Current identity", "Historical logo files"],
  "Site photography": ["Site photography", "Current site photography", "Current photography"],
  "Current site photography": ["Current site photography", "Site photography", "Current photography"],
  "Study materials": ["Study materials", "Study flyers"],
  "Legacy site imagery": ["Legacy site imagery", "Historical imagery", "Historical logo files"],
};

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

export function siteAssetCatalog() {
  return SITE_ASSETS;
}

function defaultDescription(asset) {
  return `Library image: ${asset.name}. Review its preview in Staff before using it on the website.`;
}

function folderNameFor(folders, folderId) {
  return folders.find((folder) => folder.id === folderId)?.name || "";
}

// A site path is the durable identity. Older imports predate source_path, so a
// filename match is allowed only inside the reviewed folder aliases and only
// when exactly one active image qualifies. Ambiguous files are never uploaded
// or registered automatically.
export function findExistingSiteAsset({ assets, folders, siteAsset }) {
  const activeImages = assets.filter((asset) => asset.status === "active" && asset.kind === "image");
  const sourceMatches = activeImages.filter((asset) => asset.sourcePath === siteAsset.path);
  if (sourceMatches.length === 1) return { asset: sourceMatches[0], ambiguous: false };
  if (sourceMatches.length > 1) return { asset: null, ambiguous: true };
  const aliases = new Set(FOLDER_ALIASES[siteAsset.folder] || [siteAsset.folder]);
  const named = activeImages.filter((asset) => normalizeMediaName(asset.name) === normalizeMediaName(displayName(siteAsset.path)) && aliases.has(folderNameFor(folders, asset.folderId)));
  return named.length === 1 ? { asset: named[0], ambiguous: false } : { asset: null, ambiguous: named.length > 1 };
}

async function syncMediaMetadata(db, asset, metadata, actor, action = "site_metadata_synced") {
  const description = metadata.description || defaultDescription(asset);
  const websiteUsage = metadata.websiteUsage || "not_used";
  const curationStatus = metadata.curationStatus || "good";
  const sourcePath = metadata.sourcePath || null;
  const needsUpdate = asset.description !== description
    || asset.websiteUsage !== websiteUsage
    || asset.curationStatus !== curationStatus
    || asset.sourcePath !== sourcePath;
  if (!needsUpdate) return false;
  const timestamp = new Date().toISOString();
  const staffActor = String(actor || "Staff").slice(0, 80);
  await db.batch([
    db.prepare(`UPDATE staff_media_assets
      SET internal_description = ?, website_usage = ?, curation_status = ?, source_path = ?,
          version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`)
      .bind(description, websiteUsage, curationStatus, sourcePath, timestamp, staffActor, asset.id),
    db.prepare(`INSERT INTO staff_media_events (id, asset_id, folder_id, action, actor, occurred_at, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), asset.id, asset.folderId, action, staffActor, timestamp, `${websiteUsage} · ${curationStatus} · ${sourcePath || "library only"}`),
  ]);
  return true;
}

export async function syncSiteMediaCatalog({ db, actor }) {
  if (!db) throw Object.assign(new Error("Media metadata storage is not configured"), { status: 422 });
  const library = await listStaffMedia(db);
  const result = { classified: 0, catalogMatched: 0, defaulted: 0, ambiguous: 0, skippedNonImage: 0 };
  const catalogMatches = SITE_ASSETS.map((siteAsset) => ({ siteAsset, match: findExistingSiteAsset({ assets: library.assets, folders: library.folders, siteAsset }) }));
  result.ambiguous = catalogMatches.filter(({ match }) => match.ambiguous).length;
  for (const asset of library.assets) {
    if (asset.status !== "active") continue;
    if (asset.kind !== "image") { result.skippedNonImage += 1; continue; }
    const candidates = catalogMatches.filter(({ match }) => match.asset?.id === asset.id).map(({ siteAsset }) => siteAsset);
    if (candidates.length > 1) { result.ambiguous += 1; continue; }
    const matched = candidates[0] || null;
    const changed = await syncMediaMetadata(db, asset, matched ? {
      description: matched.description, websiteUsage: matched.websiteUsage,
      curationStatus: matched.curationStatus, sourcePath: matched.path,
    } : { description: asset.description || defaultDescription(asset), websiteUsage: "not_used", curationStatus: "good", sourcePath: asset.sourcePath }, actor, matched ? "site_metadata_synced" : "library_metadata_defaulted");
    if (changed) result.classified += 1;
    if (matched) result.catalogMatched += 1;
    else result.defaulted += 1;
  }
  return result;
}

export async function importSiteMediaBatch({ db, bucket, origin, actor, offset = 0, fetcher = fetch }) {
  if (!db || !bucket) throw Object.assign(new Error("Media upload storage is not configured"), { status: 422 });
  const start = Math.max(0, Number.parseInt(offset, 10) || 0);
  const group = SITE_ASSETS.slice(start, start + CHUNK_SIZE);
  const library = await listStaffMedia(db);
  const root = await ensureFolder(db, library.folders, ROOT_FOLDER, null, actor);
  const folders = new Map();
  const result = { imported: [], skipped: [], failed: [], total: SITE_ASSETS.length, nextOffset: Math.min(start + group.length, SITE_ASSETS.length) };

  for (const siteAsset of group) {
    const { folder: folderName, path } = siteAsset;
    const name = displayName(path);
    const existing = findExistingSiteAsset({ assets: library.assets, folders: library.folders, siteAsset });
    if (existing.asset) {
      await syncMediaMetadata(db, existing.asset, { description: siteAsset.description, websiteUsage: siteAsset.websiteUsage, curationStatus: siteAsset.curationStatus, sourcePath: path }, actor);
      result.skipped.push(name);
      continue;
    }
    if (existing.ambiguous) { result.failed.push({ name, error: "Multiple legacy library images match this site asset; review before importing." }); continue; }
    if (!folders.has(folderName)) folders.set(folderName, await ensureFolder(db, library.folders, folderName, root.id, actor));
    const folder = folders.get(folderName);
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
        const registered = await registerMediaAsset(db, {
          name, mimeType, sizeBytes: bytes.byteLength, folderId: folder.id,
          description: siteAsset.description, websiteUsage: siteAsset.websiteUsage,
          curationStatus: siteAsset.curationStatus, sourcePath: path,
        }, { actor, id: assetId, allowSvg: true });
        library.assets.push(registered.asset);
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
