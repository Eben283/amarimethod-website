import type { ContactNote } from '../types/staff';

interface Props {
  notes: ContactNote[];
}

export default function NotesList({ notes }: Props) {
  if (notes.length === 0) {
    return <p className="text-sm text-amari-text-muted">No notes yet</p>;
  }

  return (
    <div className="space-y-2">
      {notes.map((note) => {
        const date = new Date(note.dateAdded);
        return (
          <div key={note.id} className="staff-card">
            <p className="text-sm text-amari-charcoal whitespace-pre-wrap">{note.body}</p>
            <p className="text-xs text-amari-text-muted mt-2">
              {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
