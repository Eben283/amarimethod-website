import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Loader2, ChevronRight, Mail, MessageSquare, Phone, ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getConversations, ApiError } from '../lib/api';
import type { ConversationSummary, ConversationFilter } from '../types/staff';

const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: 'needs_reply', label: 'Needs Reply' },
  { id: 'unread', label: 'Unread' },
  { id: 'all', label: 'All' },
];

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ChannelIcon({ type }: { type: string }) {
  if (type === 'Email') return <Mail className="w-3.5 h-3.5" />;
  if (type === 'Call') return <Phone className="w-3.5 h-3.5" />;
  return <MessageSquare className="w-3.5 h-3.5" />;
}

export default function MessagesPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const debugMode = searchParams.get('debug') === '1';

  const [filter, setFilter] = useState<ConversationFilter>('needs_reply');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [debugPayload, setDebugPayload] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (f: ConversationFilter) => {
      setIsLoading(true);
      setError('');
      try {
        const data = await getConversations(f, debugMode);
        setConversations(data.conversations);
        if (debugMode) {
          setDebugPayload((data as { debug?: unknown }).debug ?? null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setIsLoading(false);
      }
    },
    [logout, debugMode],
  );

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-serif text-amari-charcoal">Messages</h1>
        <button
          onClick={() => load(filter)}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-amari-light-sand min-w-[36px] min-h-[36px] flex items-center justify-center"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-amari-text-muted ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex bg-amari-light-sand rounded-lg p-0.5 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === f.id ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
        </div>
      ) : error ? (
        <div className="staff-card text-center py-8">
          <p className="text-red-500 text-sm mb-3">{error}</p>
          <button onClick={() => load(filter)} className="staff-btn-secondary text-sm">
            Try Again
          </button>
        </div>
      ) : conversations.length === 0 ? (
        <div className="staff-card text-center py-12">
          <p className="text-amari-text-muted text-sm">
            {filter === 'needs_reply'
              ? 'All caught up — nothing to reply to'
              : filter === 'unread'
              ? 'No unread messages'
              : 'No conversations'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <ConversationRow
              key={conv.id}
              conversation={conv}
              onTap={() => navigate(`/client/${conv.contactId}?focus=messages`)}
            />
          ))}
        </div>
      )}

      {/* Debug panel — only visible when ?debug=1 is in the URL */}
      {debugMode && debugPayload != null && (
        <div className="mt-4 border border-amber-300 bg-amber-50 rounded-lg p-3">
          <h3 className="text-sm font-semibold text-amber-900 mb-2">Debug</h3>
          <pre className="text-[10px] text-amber-900 whitespace-pre-wrap break-words overflow-auto max-h-[600px]">
            {JSON.stringify(debugPayload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ConversationRow({
  conversation,
  onTap,
}: {
  conversation: ConversationSummary;
  onTap: () => void;
}) {
  const needsReply = conversation.needsReply;
  const ghlUrl = `https://app.gohighlevel.com/v2/location/7pIO7FHVAyBT1jKGhfQM/contacts/detail/${conversation.contactId}`;

  return (
    <div
      className={`staff-card-tap w-full flex items-start gap-3 ${
        needsReply ? 'border-l-2 border-l-amari-accent-warm' : ''
      }`}
    >
      <button onClick={onTap} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-amari-charcoal truncate">
            {conversation.contactName}
          </p>
          {conversation.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amari-accent-warm text-white text-[10px] font-semibold">
              {conversation.unreadCount}
            </span>
          )}
        </div>
        <p className="text-xs text-amari-text-muted line-clamp-2 mt-0.5">
          {conversation.lastMessagePreview || <em>No message preview</em>}
        </p>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-amari-text-muted">
          <span className="inline-flex items-center gap-1">
            <ChannelIcon type={conversation.lastMessageType} />
            {conversation.lastMessageType}
          </span>
          <span>·</span>
          <span>{relativeTime(conversation.lastMessageDate)}</span>
          {conversation.lastMessageDirection === 'inbound' && (
            <>
              <span>·</span>
              <span className="text-amari-accent-warm font-medium">Client sent</span>
            </>
          )}
        </div>
      </button>
      <a
        href={ghlUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-amari-text-muted hover:text-amari-accent-warm"
        aria-label="Reply in GHL"
        title="Reply in GHL"
      >
        <ExternalLink className="w-4 h-4" />
      </a>
    </div>
  );
}
