import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getCurrentParking, sendMessage, startGoogleCalendarReconnect } from '../lib/api';
import MessageBubble from '../components/MessageBubble';
import ChatInput from '../components/ChatInput';
import ActionCard from '../components/ActionCard';
import ParkingHome from '../components/ParkingHome';
import type { ChatMessage, ParkingSnapshot, QueuedAction } from '../types/cos';
import { CalendarDays, LogOut, RotateCcw } from 'lucide-react';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export default function ChatPage() {
  const { logout } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [googleStatus, setGoogleStatus] = useState('');
  const [parking, setParking] = useState<ParkingSnapshot | null>(null);
  const [parkingLoading, setParkingLoading] = useState(true);
  const [parkingError, setParkingError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  useEffect(() => {
    const google = new URLSearchParams(window.location.search).get('google');
    if (google === 'connected') setGoogleStatus('Google Calendar connected.');
    if (google === 'failed') setGoogleError('Google Calendar could not be connected. Please try again.');
    if (google) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const loadParking = useCallback(async () => {
    setParkingLoading(true);
    setParkingError('');
    try {
      setParking(await getCurrentParking());
    } catch (error) {
      setParkingError(error instanceof Error ? error.message : 'Could not load saved parking.');
    } finally {
      setParkingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadParking();
  }, [loadParking]);

  const handleSend = useCallback(async (text: string, images?: string[]) => {
    if (isStreaming) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: images?.length ? `${text}\n[${images.length} image${images.length === 1 ? '' : 's'} attached]` : text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');

    let fullContent = '';

    await sendMessage(
      text,
      images,
      (chunk) => {
        fullContent += chunk;
        setStreamingContent(fullContent);
      },
      (actions) => {
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: fullContent,
          timestamp: Date.now(),
          actions: actions as QueuedAction[],
        };
        setMessages(prev => [...prev, assistantMessage]);
        setStreamingContent('');
        setIsStreaming(false);
        void loadParking();
      },
      (error) => {
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: `Something went wrong: ${error}`,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, errorMessage]);
        setStreamingContent('');
        setIsStreaming(false);
      },
    );
  }, [isStreaming]);

  const handleNewChat = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
    setStreamingContent('');
  }, [isStreaming]);

  const handleGoogleReconnect = useCallback(async () => {
    if (isStreaming) return;
    setGoogleError('');
    try {
      const authorizationUrl = await startGoogleCalendarReconnect();
      window.location.assign(authorizationUrl);
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : 'Could not start Google Calendar reconnect.');
    }
  }, [isStreaming]);

  return (
    <div className="h-screen h-[100dvh] flex flex-col bg-cos-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pb-3 pt-14 border-b border-cos-border">
        <h1 className="text-base font-semibold text-cos-text">Chief of Staff</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            disabled={isStreaming || messages.length === 0}
            className="cos-btn-ghost disabled:opacity-30"
            title="New conversation"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <button
            onClick={handleGoogleReconnect}
            disabled={isStreaming}
            className="cos-btn-ghost disabled:opacity-30"
            title="Reconnect Google Calendar"
          >
            <CalendarDays className="w-5 h-5" />
          </button>
          <button
            onClick={logout}
            className="cos-btn-ghost"
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>
      {googleStatus && <p className="px-4 py-2 text-sm text-emerald-300">{googleStatus}</p>}
      {googleError && <p className="px-4 py-2 text-sm text-red-300">{googleError}</p>}

      {/* Messages */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 && !isStreaming && (
          <ParkingHome
            parking={parking}
            isLoading={parkingLoading}
            error={parkingError}
            onRefresh={() => void loadParking()}
          />
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} />
            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-2 ml-0 space-y-2">
                {msg.actions.map((action) => (
                  <ActionCard key={action.id} action={action} />
                ))}
              </div>
            )}
          </div>
        ))}

        {isStreaming && streamingContent && (
          <MessageBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingContent,
              timestamp: Date.now(),
            }}
          />
        )}

        {isStreaming && !streamingContent && (
          <div className="flex gap-1.5 px-4 py-3">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
