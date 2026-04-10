import type { ContactMessage } from '../types/staff';

interface Props {
  messages: ContactMessage[];
}

export default function MessageHistory({ messages }: Props) {
  if (messages.length === 0) {
    return <p className="text-sm text-amari-text-muted">No recent messages</p>;
  }

  return (
    <div className="space-y-2">
      {messages.map((msg) => {
        const date = new Date(msg.dateAdded);
        const isInbound = msg.direction === 'inbound';
        return (
          <div
            key={msg.id}
            className={`staff-card ${isInbound ? 'border-l-2 border-l-amari-accent-warm' : ''}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium ${isInbound ? 'text-amari-accent-warm' : 'text-amari-text-muted'}`}>
                {isInbound ? 'Client' : 'Sent'}
              </span>
              <span className="text-xs text-amari-text-muted">
                {msg.type === 'SMS' ? 'SMS' : 'Email'}
              </span>
              <span className="text-xs text-amari-text-muted ml-auto">
                {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <p className="text-sm text-amari-charcoal whitespace-pre-wrap break-words">{msg.body}</p>
          </div>
        );
      })}
    </div>
  );
}
