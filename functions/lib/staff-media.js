const MAX_FILE_BYTES = 95 * 1024 * 1024;
const MAX_NAME_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 600;
const WEBSITE_USAGES = new Set(["currently_used", "not_used"]);
const CURATION_STATUSES = new Set(["good", "delete_candidate"]);

export const STAFF_MEDIA_TYPES = Object.freeze({
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
  "image/svg+xml": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "application/pdf": "document",
});

function failure(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function cleanText(value, max = MAX_NAME_LENGTH) {
  return typeof value === "string"
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").slice(0, max)
    : "";
}

function cleanChoice(value, allowed, fallback) {
  const choice = cleanText(value, 40);
  if (!choice) return fallback;
  if (!allowed.has(choice)) throw failure("Choose a valid media classification");
  return choice;
}

export function normalizeMediaName(value) {
  return cleanText(value).toLocaleLowerCase("en-US");
}

export function validateMediaUpload({ name, mimeType, sizeBytes }, { allowSvg = false } = {}) {
  const displayName = cleanText(name);
  const type = cleanText(mimeType, 100).toLowerCase();
  const size = Number(sizeBytes);
  if (displayName.length < 1) throw failure("A file name is required");
  if (!STAFF_MEDIA_TYPES[type] || (type === "image/svg+xml" && !allowSvg)) {
    throw failure("Use a JPG, PNG, WebP, GIF, AVIF, MP4, MOV, WebM, or PDF file");
  }
  if (!Number.isSafeInteger(size) || size < 1) throw failure("The file is empty or its size could not be verified");
  if (size > MAX_FILE_BYTES) throw failure("Files must be 95 MB or smaller");
  return {
    displayName,
    normalizedName: normalizeMediaName(displayName),
    mimeType: type,
    kind: STAFF_MEDIA_TYPES[type],
    sizeBytes: size,
  };
}

export function mediaObjectKey(assetId, mimeType) {
  const extension = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "application/pdf": "pdf",
  }[mimeType];
  if (!/^[a-f0-9-]{32,40}$/i.test(assetId) || !extension) throw failure("Could not create a safe media key", 500);
  return `staff-media/${assetId}.${extension}`;
}

function mapFolder(row) {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    status: row.status,
    version: Number(row.version),
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapAsset(row) {
  return {
    id: row.id,
    folderId: row.folder_id || null,
    name: row.display_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    kind: STAFF_MEDIA_TYPES[row.mime_type] || "file",
    sizeBytes: Number(row.size_bytes),
    description: row.internal_description || "",
    websiteUsage: row.website_usage || "not_used",
    curationStatus: row.curation_status || "good",
    sourcePath: row.source_path || null,
    status: row.status,
    version: Number(row.version),
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    previewUrl: `/api/staff-media-file?id=${encodeURIComponent(row.id)}`,
    downloadUrl: `/api/staff-media-file?id=${encodeURIComponent(row.id)}&download=1`,
    internalUrl: `/staff/media?asset=${encodeURIComponent(row.id)}`,
  };
}

async function requireFolder(db, folderId) {
  if (!folderId) return null;
  const row = await db.prepare("SELECT id, status FROM staff_media_folders WHERE id = ?").bind(folderId).first();
  if (!row || row.status !== "active") throw failure("Choose an active media folder", 404);
  return row;
}

export async function listStaffMedia(db, { includeArchived = false } = {}) {
  if (!db) throw failure("Media metadata storage is not configured", 422);
  const statusClause = includeArchived ? "" : "WHERE status = 'active'";
  const [foldersResult, assetsResult] = await Promise.all([
    db.prepare(`SELECT * FROM staff_media_folders ${statusClause} ORDER BY name COLLATE NOCASE`).all(),
    db.prepare(`SELECT * FROM staff_media_assets ${statusClause} ORDER BY updated_at DESC`).all(),
  ]);
  return {
    folders: (foldersResult?.results || []).map(mapFolder),
    assets: (assetsResult?.results || []).map(mapAsset),
  };
}

export async function createMediaFolder(db, input, { actor, now, id } = {}) {
  if (!db) throw failure("Media metadata storage is not configured", 422);
  const allowed = new Set(["action", "name", "parentId"]);
  for (const key of Object.keys(input || {})) if (!allowed.has(key)) throw failure(`Unknown folder field: ${key}`);
  const name = cleanText(input?.name, 80);
  if (!name) throw failure("Folder name is required");
  const parentId = cleanText(input?.parentId, 80) || null;
  await requireFolder(db, parentId);
  const folderId = id || crypto.randomUUID();
  const timestamp = now || new Date().toISOString();
  const staffActor = cleanText(actor, 80) || "Staff";
  try {
    await db.batch([
      db.prepare(`INSERT INTO staff_media_folders
        (id, parent_id, name, normalized_name, status, version, created_at, created_by, updated_at, updated_by)
        VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`)
        .bind(folderId, parentId, name, normalizeMediaName(name), timestamp, staffActor, timestamp, staffActor),
      db.prepare(`INSERT INTO staff_media_events (id, folder_id, action, actor, occurred_at, detail)
        VALUES (?, ?, 'folder_created', ?, ?, ?)`)
        .bind(crypto.randomUUID(), folderId, staffActor, timestamp, `Created folder ${name}`),
    ]);
  } catch (cause) {
    if (/unique|constraint/i.test(String(cause))) throw failure("A folder with that name already exists here", 409);
    throw cause;
  }
  return mapFolder({ id: folderId, parent_id: parentId, name, status: "active", version: 1, created_at: timestamp, created_by: staffActor, updated_at: timestamp, updated_by: staffActor });
}

export async function registerMediaAsset(db, input, { actor, now, id, allowSvg = false } = {}) {
  if (!db) throw failure("Media metadata storage is not configured", 422);
  const upload = validateMediaUpload(input, { allowSvg });
  const folderId = cleanText(input?.folderId, 80) || null;
  await requireFolder(db, folderId);
  const assetId = id || crypto.randomUUID();
  const objectKey = mediaObjectKey(assetId, upload.mimeType);
  const description = cleanText(input?.description, MAX_DESCRIPTION_LENGTH);
  const websiteUsage = cleanChoice(input?.websiteUsage, WEBSITE_USAGES, "not_used");
  const curationStatus = cleanChoice(input?.curationStatus, CURATION_STATUSES, "good");
  const sourcePath = cleanText(input?.sourcePath, 500) || null;
  const timestamp = now || new Date().toISOString();
  const staffActor = cleanText(actor, 80) || "Staff";
  try {
    await db.batch([
      db.prepare(`INSERT INTO staff_media_assets
        (id, folder_id, object_key, display_name, original_name, normalized_name, mime_type, size_bytes,
         internal_description, website_usage, curation_status, source_path, status, version, created_at, created_by, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`)
        .bind(assetId, folderId, objectKey, upload.displayName, upload.displayName, upload.normalizedName, upload.mimeType, upload.sizeBytes, description, websiteUsage, curationStatus, sourcePath, timestamp, staffActor, timestamp, staffActor),
      db.prepare(`INSERT INTO staff_media_events (id, asset_id, folder_id, action, actor, occurred_at, detail)
        VALUES (?, ?, ?, 'uploaded', ?, ?, ?)`)
        .bind(crypto.randomUUID(), assetId, folderId, staffActor, timestamp, `${upload.mimeType} · ${upload.sizeBytes} bytes`),
    ]);
  } catch (cause) {
    if (/unique|constraint/i.test(String(cause))) throw failure("A file with that name already exists in this folder", 409);
    throw cause;
  }
  return { asset: mapAsset({ id: assetId, folder_id: folderId, object_key: objectKey, display_name: upload.displayName, original_name: upload.displayName, mime_type: upload.mimeType, size_bytes: upload.sizeBytes, internal_description: description, website_usage: websiteUsage, curation_status: curationStatus, source_path: sourcePath, status: "active", version: 1, created_at: timestamp, created_by: staffActor, updated_at: timestamp, updated_by: staffActor }), objectKey };
}

export async function updateMediaAsset(db, input, { actor, now } = {}) {
  if (!db) throw failure("Media metadata storage is not configured", 422);
  const allowed = new Set(["action", "assetId", "name", "folderId", "description", "websiteUsage", "curationStatus", "sourcePath"]);
  for (const key of Object.keys(input || {})) if (!allowed.has(key)) throw failure(`Unknown media field: ${key}`);
  const action = input?.action;
  if (!["rename_asset", "move_asset", "archive_asset", "restore_asset", "curate_asset"].includes(action)) throw failure("Choose a valid media action");
  const assetId = cleanText(input?.assetId, 80);
  const current = assetId ? await db.prepare("SELECT * FROM staff_media_assets WHERE id = ?").bind(assetId).first() : null;
  if (!current) throw failure("Media file not found", 404);
  const timestamp = now || new Date().toISOString();
  const staffActor = cleanText(actor, 80) || "Staff";
  let name = current.display_name;
  let normalizedName = current.normalized_name;
  let folderId = current.folder_id || null;
  let status = current.status;
  let description = current.internal_description || "";
  let websiteUsage = current.website_usage || "not_used";
  let curationStatus = current.curation_status || "good";
  let sourcePath = current.source_path || null;
  if (action === "rename_asset") {
    name = cleanText(input?.name);
    if (!name) throw failure("File name is required");
    normalizedName = normalizeMediaName(name);
  } else if (action === "move_asset") {
    folderId = cleanText(input?.folderId, 80) || null;
    await requireFolder(db, folderId);
  } else if (action === "archive_asset") {
    status = "archived";
  } else if (action === "curate_asset") {
    description = cleanText(input?.description, MAX_DESCRIPTION_LENGTH);
    websiteUsage = cleanChoice(input?.websiteUsage, WEBSITE_USAGES, websiteUsage);
    curationStatus = cleanChoice(input?.curationStatus, CURATION_STATUSES, curationStatus);
    sourcePath = cleanText(input?.sourcePath, 500) || null;
  } else {
    status = "active";
  }
  try {
    await db.batch([
      db.prepare(`UPDATE staff_media_assets
        SET folder_id = ?, display_name = ?, normalized_name = ?, internal_description = ?, website_usage = ?,
            curation_status = ?, source_path = ?, status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`)
        .bind(folderId, name, normalizedName, description, websiteUsage, curationStatus, sourcePath, status, timestamp, staffActor, assetId),
      db.prepare(`INSERT INTO staff_media_events (id, asset_id, folder_id, action, actor, occurred_at, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), assetId, folderId, action, staffActor, timestamp, action === "curate_asset" ? `${websiteUsage} · ${curationStatus} · ${description || "No description"}` : name),
    ]);
  } catch (cause) {
    if (/unique|constraint/i.test(String(cause))) throw failure("A file with that name already exists in this folder", 409);
    throw cause;
  }
  return mapAsset({ ...current, folder_id: folderId, display_name: name, normalized_name: normalizedName, internal_description: description, website_usage: websiteUsage, curation_status: curationStatus, source_path: sourcePath, status, version: Number(current.version) + 1, updated_at: timestamp, updated_by: staffActor });
}

export async function getMediaAssetRecord(db, assetId) {
  if (!db) throw failure("Media metadata storage is not configured", 422);
  const id = cleanText(assetId, 80);
  const row = id ? await db.prepare("SELECT * FROM staff_media_assets WHERE id = ?").bind(id).first() : null;
  if (!row || row.status !== "active") throw failure("Media file not found", 404);
  return { public: mapAsset(row), objectKey: row.object_key };
}
