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

export default function SessionDocSheet({ contactId, clientName, onClose }: Props) {
  const [progress, setProgress] = useState<ClientModuleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

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

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    clearTimeout(savedTimer.current);
  }, []);

  const handleUpdate = useCallback((next: ClientModuleData) => {
    setProgress(next);
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProgress(contactId, next)
        .then(() => {
          setSaveStatus('saved');
          clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
        })
        .catch(() => setSaveStatus('idle'));
    }, 800);
  }, [contactId]);

  const content = (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
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
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-amari-light-sand"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-amari-charcoal" />
            </button>
          </div>
        </div>

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
