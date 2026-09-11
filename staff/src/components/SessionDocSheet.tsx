import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { getContactDetail, saveProgress } from '../lib/api';
import {
  MODULES,
  defaultData,
  toggleModule,
  setYogaBlockSize,
  type ClientModuleData,
} from '../data/moduleStorage';
import BodyMapCanvas from './BodyMapCanvas';

interface Props {
  contactId: string;
  clientName: string;
  onClose: () => void;
}

export default function SessionDocSheet(props: Props) {
  return <SessionDocWorkspace key={props.contactId} {...props} />;
}

function SessionDocWorkspace({ contactId, clientName, onClose }: Props) {
  const [progress, setProgress] = useState<ClientModuleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const [saveError, setSaveError] = useState('');
  const pendingProgress = useRef<ClientModuleData | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError('');
    getContactDetail(contactId)
      .then((detail) => {
        if (cancelled) return;
        setProgress(
          detail.clientProgress
            ? { ...defaultData(), ...(detail.clientProgress as Partial<ClientModuleData>) }
            : defaultData(),
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError('Failed to load session data.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [contactId]);

  const flushSave = useCallback((): Promise<boolean> => {
    clearTimeout(saveTimer.current);
    if (inFlight.current) return inFlight.current;
    if (!pendingProgress.current) return Promise.resolve(true);
    setSaveStatus('saving');
    setSaveError('');
    // Serialize complete snapshots so a slower earlier write cannot erase a newer edit.
    const task = Promise.resolve().then(async () => {
      while (pendingProgress.current) {
        const next = pendingProgress.current;
        pendingProgress.current = null;
        try {
          await saveProgress(contactId, next);
        } catch {
          pendingProgress.current ??= next;
          setSaveStatus('error');
          setSaveError('Changes have not been saved. Please retry before closing.');
          return false;
        }
      }
      setSaveStatus('saved');
      return true;
    });
    inFlight.current = task;
    void task.then(() => { if (inFlight.current === task) inFlight.current = null; });
    return task;
  }, [contactId]);

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    // Navigation must dispatch accepted edits for this member, not discard the debounce.
    void flushSave();
  }, [flushSave]);

  const handleUpdate = useCallback((next: ClientModuleData) => {
    setProgress(next);
    pendingProgress.current = next;
    setSaveStatus('saving');
    setSaveError('');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave(); }, 800);
  }, [flushSave]);

  async function requestClose() {
    if (closing.current) return;
    closing.current = true;
    try {
      if (await flushSave()) onClose();
    } finally {
      closing.current = false;
    }
  }

  const content = (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => { void requestClose(); }}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-t-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-amari-border flex-shrink-0">
          <div>
            <p className="text-xs text-amari-text-muted">Session notes</p>
            <h2 className="text-base font-semibold text-amari-charcoal">{clientName}</h2>
          </div>
          <div className="flex items-center gap-3">
            {saveStatus === 'saving' && (
              <span className="text-xs text-amari-text-muted">Saving…</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-600">Saved</span>
            )}
            {saveStatus === 'error' && <span className="text-xs text-red-700">Not saved</span>}
            <button
              onClick={() => { void requestClose(); }}
              className="p-2 rounded-lg hover:bg-amari-light-sand"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-amari-charcoal" />
            </button>
          </div>
        </div>

        {saveError && (
          <div className="px-5 py-3 text-sm text-red-700" role="alert">
            <p>{saveError}</p>
            <button type="button" className="underline mt-2" onClick={() => { void flushSave(); }}>Retry saving</button>
          </div>
        )}
        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-7 h-7 animate-spin text-amari-charcoal" />
            </div>
          ) : loadError ? (
            <p className="text-sm text-red-500 text-center py-8">{loadError}</p>
          ) : progress ? (
            <>
              {/* Protocols */}
              <div>
                <p className="text-xs font-medium text-amari-text-muted uppercase tracking-wide mb-3">
                  Protocols taught
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {MODULES.map((m) => {
                    const on = Boolean(progress.modules[m.id]);
                    return (
                      <button
                        key={m.id}
                        onClick={() => handleUpdate(toggleModule(progress, m.id))}
                        className={`px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                          on
                            ? 'bg-amari-charcoal text-white'
                            : 'bg-amari-light-sand text-amari-charcoal hover:bg-amari-border'
                        }`}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Yoga block size */}
              <div>
                <p className="text-xs font-medium text-amari-text-muted uppercase tracking-wide mb-3">
                  Yoga block
                </p>
                <div className="flex gap-2">
                  {(['3', '4'] as const).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => handleUpdate(setYogaBlockSize(progress, sz))}
                      className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                        progress.yogaBlockSize === sz
                          ? 'bg-amari-charcoal text-white'
                          : 'bg-amari-light-sand text-amari-charcoal hover:bg-amari-border'
                      }`}
                    >
                      {sz}"
                    </button>
                  ))}
                  {progress.yogaBlockSize && (
                    <button
                      onClick={() => handleUpdate({ ...progress, yogaBlockSize: null })}
                      className="px-4 py-2 rounded-lg text-sm bg-amari-light-sand text-amari-text-muted hover:bg-amari-border"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Body map */}
              <div>
                <p className="text-xs font-medium text-amari-text-muted uppercase tracking-wide mb-3">
                  Body map
                </p>
                <BodyMapCanvas data={progress} onUpdate={handleUpdate} />
              </div>

              {/* Bottom padding for safe area */}
              <div className="h-4" />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
