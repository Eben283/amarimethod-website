import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { addNote, ApiError } from '../lib/api';

interface Props {
  contactId: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function AddNoteModal({ contactId, onClose, onSaved }: Props) {
  const [body, setBody] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!body.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      await addNote(contactId, body.trim());
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save note');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-4 pb-8 sm:pb-4 animate-fade-in">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-serif text-amari-charcoal">Add Note</h3>
          <button onClick={onClose} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X className="w-5 h-5 text-amari-text-muted" />
          </button>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Session notes..."
          rows={4}
          className="staff-input resize-none mb-3"
          autoFocus
        />

        {error && <p className="text-red-500 text-sm mb-2">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="staff-btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !body.trim()}
            className="staff-btn-primary flex-1 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
