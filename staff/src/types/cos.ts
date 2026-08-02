// Chief-of-Staff chat types — ported from the standalone COS app so the chat can
// run natively inside the staff app (in-session questions).

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  actions?: QueuedAction[];
  draft?: VoiceDraftMeta;
}

export interface VoiceDraftMeta {
  channel: string;
  fixes: string[];
  rounds: number;
  passedClean: boolean;
  remainingTells: string[];
}

export interface QueuedAction {
  id: string;
  type: 'grocery' | 'purchase' | 'task' | 'research' | 'calendar' | 'coach';
  item: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  details?: Record<string, unknown>;
  store?: string;
  reason?: string;
  questions?: string[];
  blocked_by?: string;
  created: number;
}
