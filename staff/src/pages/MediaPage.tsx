import {
  Archive,
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  Image as ImageIcon,
  Images,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getStaffMedia,
  importStaffSiteMedia,
  syncStaffSiteMediaCatalog,
  updateStaffMedia,
  uploadStaffMedia,
  type StaffMediaAsset,
  type StaffMediaFolder,
  type StaffMediaKind,
} from '../lib/api';
import './MediaPage.css';
import './MediaCuration.css';

type ViewMode = 'grid' | 'list';
type TypeFilter = 'all' | StaffMediaKind;

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function exactTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short',
  }).format(new Date(value));
}

function KindIcon({ kind }: { kind: StaffMediaKind }) {
  if (kind === 'image') return <ImageIcon aria-hidden="true" />;
  if (kind === 'video') return <Video aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

function Preview({ asset, large = false }: { asset: StaffMediaAsset; large?: boolean }) {
  if (asset.kind === 'image') return <img src={asset.previewUrl} alt="" loading="lazy" />;
  if (asset.kind === 'video' && large) return <video src={asset.previewUrl} controls preload="metadata" />;
  return <div className={`media-file-fallback media-file-fallback--${asset.kind}`}><KindIcon kind={asset.kind} /><span>{asset.mimeType === 'application/pdf' ? 'PDF' : asset.kind}</span></div>;
}

function NewFolderDialog({ parentId, onClose, onCreated }: { parentId: string | null; onClose: () => void; onCreated: (folder: StaffMediaFolder) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await updateStaffMedia({ action: 'create_folder', name: name.trim(), parentId });
      if (result.folder) onCreated(result.folder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Folder could not be created.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="media-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="media-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="media-folder-title" onSubmit={submit}>
        <header><div><span>Organize the library</span><h2 id="media-folder-title">New folder</h2></div><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
        <label>Folder name<input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Client handouts" /></label>
        {error ? <p role="alert">{error}</p> : null}
        <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={saving || !name.trim()}>{saving ? <Loader2 /> : <FolderPlus />} Create folder</button></footer>
      </form>
    </div>
  );
}

function AssetDrawer({ asset, folders, onClose, onChanged, onReconcile }: { asset: StaffMediaAsset; folders: StaffMediaFolder[]; onClose: () => void; onChanged: (asset: StaffMediaAsset) => void; onReconcile: (assetId: string) => Promise<StaffMediaAsset | null> }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(asset.name);
  const [description, setDescription] = useState(asset.description);
  const [websiteUsage, setWebsiteUsage] = useState(asset.websiteUsage);
  const [curationStatus, setCurationStatus] = useState(asset.curationStatus);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function mutate(input: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const result = await updateStaffMedia(input);
      if (result.asset) onChanged(result.asset);
      return result.asset || null;
    } catch (cause) {
      if ((cause as { status?: number })?.status === 408) {
        const reconciled = await onReconcile(asset.id);
        if (reconciled) {
          onChanged(reconciled);
          setNotice(reconciled.status === asset.status ? 'The request timed out. The file is unchanged after a fresh read.' : reconciled.status === 'archived' ? 'The request timed out, but the file was archived.' : 'The request timed out, but the file was restored.');
          return reconciled;
        }
      }
      setError(cause instanceof Error ? cause.message : 'The file could not be updated.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copyInternalLink() {
    await navigator.clipboard.writeText(`${window.location.origin}${asset.internalUrl}`);
    setNotice('Internal Staff link copied.');
  }

  return (
    <div className="media-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="media-drawer" role="dialog" aria-modal="true" aria-labelledby="media-detail-title">
        <header><div><span>Private Staff file</span><h2 id="media-detail-title">File details</h2></div><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
        <div className="media-drawer__preview"><Preview asset={asset} large /></div>
        <section className="media-drawer__identity">
          {renaming ? (
            <form onSubmit={async (event) => { event.preventDefault(); const changed = await mutate({ action: 'rename_asset', assetId: asset.id, name }); if (changed) setRenaming(false); }}>
              <input autoFocus value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
              <button type="submit" disabled={busy || !name.trim()}><Check /> Save</button>
            </form>
          ) : <><h3>{asset.name}</h3><button type="button" onClick={() => setRenaming(true)}><Pencil /> Rename</button></>}
          <p>{fileSize(asset.sizeBytes)} · {asset.mimeType}</p>
        </section>
        <dl>
          <div><dt>Folder</dt><dd><select value={asset.folderId || ''} disabled={busy || asset.status === 'archived'} onChange={async (event) => { await mutate({ action: 'move_asset', assetId: asset.id, folderId: event.target.value || null }); }}><option value="">All media</option>{folders.filter((folder) => folder.status === 'active').map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></dd></div>
          <div className="media-drawer__curation"><dt>Library note</dt><dd><textarea value={description} maxLength={600} disabled={busy || asset.status === 'archived'} onChange={(event) => setDescription(event.target.value)} placeholder="What is visibly happening and what this asset communicates" /><button type="button" disabled={busy || asset.status === 'archived'} onClick={async () => { const changed = await mutate({ action: 'curate_asset', assetId: asset.id, description, websiteUsage, curationStatus, sourcePath: asset.sourcePath }); if (changed) setNotice('Library description and classification saved.'); }}><Check /> Save classification</button></dd></div>
          <div><dt>Website use</dt><dd><select value={websiteUsage} disabled={busy || asset.status === 'archived'} onChange={(event) => setWebsiteUsage(event.target.value as StaffMediaAsset['websiteUsage'])}><option value="currently_used">Currently used on website</option><option value="not_used">Not used on website</option></select></dd></div>
          <div><dt>Curation</dt><dd><select value={curationStatus} disabled={busy || asset.status === 'archived'} onChange={(event) => setCurationStatus(event.target.value as StaffMediaAsset['curationStatus'])}><option value="good">Good — keep in library</option><option value="delete_candidate">Delete candidate — preserve original</option></select></dd></div>
          {asset.sourcePath ? <div><dt>Site source</dt><dd>{asset.sourcePath}</dd></div> : null}
          <div><dt>Uploaded</dt><dd>{exactTime(asset.createdAt)} by {asset.createdBy}</dd></div>
          <div><dt>Privacy</dt><dd>Staff only · authentication required</dd></div>
        </dl>
        <div className="media-drawer__actions">
          <button type="button" onClick={() => void copyInternalLink()}><Copy /> Copy internal link</button>
          <a href={asset.downloadUrl}><Download /> Download original</a>
          <button type="button" className="is-caution" disabled={busy} onClick={async () => { const changed = await mutate({ action: asset.status === 'archived' ? 'restore_asset' : 'archive_asset', assetId: asset.id }); if (changed) setNotice(asset.status === 'archived' ? 'File restored.' : 'File archived. The stored object was not deleted.'); }}><Archive /> {asset.status === 'archived' ? 'Restore file' : 'Archive file'}</button>
        </div>
        {notice ? <p className="media-drawer__notice" role="status">{notice}</p> : null}
        {error ? <p className="media-drawer__error" role="alert">{error}</p> : null}
      </aside>
    </div>
  );
}

export default function MediaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [folders, setFolders] = useState<StaffMediaFolder[]>([]);
  const [assets, setAssets] = useState<StaffMediaAsset[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [view, setView] = useState<ViewMode>('grid');
  const [showArchived, setShowArchived] = useState(false);
  const [uploadReady, setUploadReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (archived = showArchived) => {
    setLoading(true);
    setError('');
    try {
      const result = await getStaffMedia(archived);
      setFolders(result.folders);
      setAssets(result.assets);
      setUploadReady(result.uploadReady);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Media library could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { void load(); }, [load]);

  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === searchParams.get('asset')) || null, [assets, searchParams]);
  const currentFolder = folders.find((folder) => folder.id === folderId) || null;
  const childFolders = folders.filter((folder) => folder.status === 'active' && (folder.parentId || null) === folderId);
  const folderStats = useMemo(() => {
    const activeFolders = folders.filter((folder) => folder.status === 'active');
    const directAssets = new Map<string, number>();
    for (const asset of assets) {
      if (asset.status !== 'active' || !asset.folderId) continue;
      directAssets.set(asset.folderId, (directAssets.get(asset.folderId) || 0) + 1);
    }
    const childIds = new Map<string, string[]>();
    for (const folder of activeFolders) {
      if (!folder.parentId) continue;
      childIds.set(folder.parentId, [...(childIds.get(folder.parentId) || []), folder.id]);
    }
    const totals = new Map<string, { assetCount: number; childFolderCount: number }>();
    const countFolder = (id: string): { assetCount: number; childFolderCount: number } => {
      const cached = totals.get(id);
      if (cached) return cached;
      const children = childIds.get(id) || [];
      const summary = children.reduce((result, childId) => {
        const child = countFolder(childId);
        return { assetCount: result.assetCount + child.assetCount, childFolderCount: result.childFolderCount + child.childFolderCount + 1 };
      }, { assetCount: directAssets.get(id) || 0, childFolderCount: 0 });
      totals.set(id, summary);
      return summary;
    };
    activeFolders.forEach((folder) => countFolder(folder.id));
    return totals;
  }, [assets, folders]);
  const folderSummary = (folder: StaffMediaFolder) => {
    const summary = folderStats.get(folder.id) || { assetCount: 0, childFolderCount: 0 };
    return summary.childFolderCount ? `${summary.childFolderCount} folder${summary.childFolderCount === 1 ? '' : 's'} · ${summary.assetCount} assets` : `${summary.assetCount} file${summary.assetCount === 1 ? '' : 's'}`;
  };
  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (!showArchived && asset.status !== 'active') return false;
      if (showArchived && asset.status !== 'archived') return false;
      if (type !== 'all' && asset.kind !== type) return false;
      if (needle) return asset.name.toLowerCase().includes(needle);
      return (asset.folderId || null) === folderId;
    });
  }, [assets, folderId, query, showArchived, type]);

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploading(true);
    setError('');
    let completed = 0;
    for (const file of files) {
      try {
        const result = await uploadStaffMedia(file, folderId);
        setAssets((current) => [result.asset, ...current]);
        completed += 1;
      } catch (cause) {
        setError(`${file.name}: ${cause instanceof Error ? cause.message : 'Upload failed.'}`);
        break;
      }
    }
    if (completed) setNotice(`${completed} file${completed === 1 ? '' : 's'} uploaded to ${currentFolder?.name || 'All media'}.`);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function dropped(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (uploadReady && !uploading) void uploadFiles(event.dataTransfer.files);
  }

  async function importPublicSiteAssets() {
    setImporting(true);
    setError('');
    setNotice('Importing current public site assets…');
    let offset = 0;
    let total = 0;
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    try {
      do {
        const result = await importStaffSiteMedia(offset);
        total = result.total;
        imported += result.imported.length;
        skipped += result.skipped.length;
        failed += result.failed.length;
        offset = result.nextOffset;
      } while (offset < total);
      await load();
      setNotice(`Site asset import complete: ${imported} added, ${skipped} already here${failed ? `, ${failed} need attention` : ''}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Site assets could not be imported.');
      setNotice('');
    } finally {
      setImporting(false);
    }
  }

  async function classifyExistingImages() {
    setClassifying(true);
    setError('');
    try {
      const result = await syncStaffSiteMediaCatalog();
      await load();
      setNotice(`Image inventory synchronized: ${result.catalogMatched} catalog matches, ${result.defaulted} library-only images classified${result.ambiguous ? `, ${result.ambiguous} ambiguous matches left for review` : ''}. No originals changed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image inventory could not be synchronized.');
    } finally {
      setClassifying(false);
    }
  }

  function openAsset(asset: StaffMediaAsset) {
    setSearchParams({ asset: asset.id });
  }

  return (
    <main className="staff-media-page">
      <header className="staff-media-head">
        <div><span>Owned asset library</span><h1>Media</h1><p>Shared images, videos, and PDFs for the Amari team.</p></div>
        <div className="staff-media-head__actions">
          <button type="button" onClick={() => setFolderDialog(true)}><FolderPlus /> New folder</button>
          <button type="button" disabled={uploading || importing || classifying} onClick={() => void classifyExistingImages()}>{classifying ? <Loader2 className="is-spinning" /> : <Check />} {classifying ? 'Classifying…' : 'Classify library images'}</button>
          <button type="button" disabled={!uploadReady || uploading || importing || classifying} onClick={() => void importPublicSiteAssets()}>{importing ? <Loader2 className="is-spinning" /> : <Images />} {importing ? 'Importing…' : 'Import site assets'}</button>
          <button type="button" className="is-primary" disabled={!uploadReady || uploading || importing || classifying} onClick={() => fileInput.current?.click()}>{uploading ? <Loader2 className="is-spinning" /> : <Upload />} {uploading ? 'Uploading…' : 'Upload files'}</button>
          <input ref={fileInput} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,application/pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void uploadFiles(event.target.files); }} />
        </div>
      </header>

      <div className="staff-media-trust"><ShieldCheck /><span><strong>Private by default.</strong> Files and copied links require a signed-in Staff session. Archiving never deletes the stored original.</span></div>
      {notice ? <div className="staff-media-notice" role="status"><Check /> {notice}</div> : null}
      {error ? <div className="staff-media-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw /> Retry</button></div> : null}

      <section className="staff-media-workspace">
        <aside className="staff-media-folders" aria-label="Media folders">
          <span>Library</span>
          <button type="button" className={!folderId && !showArchived ? 'is-active' : ''} onClick={() => { setFolderId(null); setShowArchived(false); }}><ImageIcon /> All media <small>{assets.filter((asset) => asset.status === 'active').length}</small></button>
          {folders.filter((folder) => folder.status === 'active' && !folder.parentId).map((folder) => (
            <button key={folder.id} type="button" className={folder.id === folderId && !showArchived ? 'is-active' : ''} onClick={() => { setFolderId(folder.id); setShowArchived(false); }}><Folder /> {folder.name}<small>{folderStats.get(folder.id)?.assetCount || 0}</small></button>
          ))}
          <button type="button" className={showArchived ? 'is-active' : ''} onClick={() => { setShowArchived(true); setFolderId(null); }}><Archive /> Archived <small>{assets.filter((asset) => asset.status === 'archived').length}</small></button>
        </aside>

        <div className="staff-media-content">
          <div className="staff-media-toolbar">
            <div className="staff-media-breadcrumb">{currentFolder ? <><button type="button" onClick={() => setFolderId(currentFolder.parentId)}><ArrowLeft /> Back</button><span>{currentFolder.name}</span></> : <span>{showArchived ? 'Archived files' : 'All media'}</span>}</div>
            <label><Search /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search file names" /></label>
            <select value={type} onChange={(event) => setType(event.target.value as TypeFilter)} aria-label="Filter by file type"><option value="all">All types</option><option value="image">Images</option><option value="video">Videos</option><option value="document">PDFs</option></select>
            <div className="staff-media-view"><button type="button" className={view === 'grid' ? 'is-active' : ''} onClick={() => setView('grid')} aria-label="Grid view"><Grid2X2 /></button><button type="button" className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')} aria-label="List view"><List /></button></div>
          </div>

          {!showArchived && !query && childFolders.length ? <div className="staff-media-folder-grid">{childFolders.map((folder) => <button key={folder.id} type="button" onClick={() => setFolderId(folder.id)}><Folder /><span><strong>{folder.name}</strong><small>{folderSummary(folder)}</small></span></button>)}</div> : null}

          <div className={`staff-media-dropzone${dragging ? ' is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={dropped}>
            {loading ? <div className="staff-media-empty"><Loader2 className="is-spinning" /><strong>Opening the library…</strong></div> : visibleAssets.length ? (
              <div className={`staff-media-files staff-media-files--${view}`}>
                {visibleAssets.map((asset) => (
                  <button key={asset.id} type="button" className="staff-media-file" onClick={() => openAsset(asset)}>
                    <div className="staff-media-file__preview"><Preview asset={asset} /><span><MoreHorizontal /></span></div>
                    <div className="staff-media-file__copy"><strong>{asset.name}</strong><small>{asset.websiteUsage === 'currently_used' ? 'Used on website' : 'Not used'} · {asset.curationStatus === 'delete_candidate' ? 'Delete candidate' : 'Keep'}</small></div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="staff-media-empty">
                <Upload />
                <strong>{showArchived ? 'Nothing is archived.' : query ? 'No files match that search.' : 'Drop files here to begin.'}</strong>
                <p>{showArchived || query ? 'Adjust the current view to see other files.' : 'Images, videos, and PDFs up to 95 MB. Files remain private to Staff.'}</p>
                {!showArchived && !query && uploadReady ? <button type="button" onClick={() => fileInput.current?.click()}>Choose files</button> : null}
              </div>
            )}
          </div>
        </div>
      </section>

      {folderDialog ? <NewFolderDialog parentId={folderId} onClose={() => setFolderDialog(false)} onCreated={(folder) => { setFolders((current) => [...current, folder]); setFolderDialog(false); setFolderId(folder.id); setNotice(`Folder “${folder.name}” created.`); }} /> : null}
      {selectedAsset ? <AssetDrawer asset={selectedAsset} folders={folders} onClose={() => setSearchParams({})} onChanged={(changed) => { setAssets((current) => current.map((asset) => asset.id === changed.id ? changed : asset)); }} onReconcile={async (assetId) => {
        const result = await getStaffMedia(true);
        setFolders(result.folders);
        setAssets(result.assets);
        setUploadReady(result.uploadReady);
        return result.assets.find((candidate) => candidate.id === assetId) || null;
      }} /> : null}
    </main>
  );
}
