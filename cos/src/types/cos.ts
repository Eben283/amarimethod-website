export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  actions?: QueuedAction[];
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

export interface Conversation {
  date: string;
  messages: ChatMessage[];
  created: number;
  updated: number;
}

export interface ParkingRule {
  type: string;
  detail: string | null;
  side: string | null;
}

export interface ParkingSnapshot {
  location: string;
  side: string | null;
  parked_at: string | null;
  deadline_iso: string | null;
  notes: string | null;
  rules: ParkingRule[];
}
