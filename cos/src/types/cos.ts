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
  type: 'grocery' | 'purchase' | 'task' | 'research' | 'calendar';
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
