import { useState, useRef, useEffect, useCallback } from 'react';
import { RotateCcw, Loader2 } from 'lucide-react';
import { sendCosMessage } from '../lib/cosApi';
import MessageBubble from '../components/cos/MessageBubble';
import ChatInput from '../components/cos/ChatInput';
import ActionCard from '../components/cos/ActionCard';
import type { ChatMessage, QueuedAction } from '../types/cos';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export default function CosPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const handleSend = useCallback(async (text: string, image?: string) => {
    if (isStreaming) return;
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: image ? `${text}\n[Image attached]` : text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');

    let fullContent = '';
    await sendCosMessage(
      text,
      image,
      (chunk) => { fullContent += chunk; setStreamingContent(fullContent); },
      (actions) => {
        setMessages((prev) => [...prev, {
          id: generateId(), role: 'assistant', content: fullContent, timestamp: Date.now(), actions: actions as QueuedAction[],
        }]);
        setStreamingContent('');
        setIsStreaming(false);
      },
      (error) => {
        setMessages((prev) => [...prev, {
          id: generateId(), role: 'assistant', content: `Something went wrong: ${error}`, timestamp: Date.now(),
        }]);
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

  return (
    // Fill the viewport minus the fixed bottom nav (~64px) so the input pins
    // above the nav and the message list scrolls between.
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 64px)' }}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-amari-border">
        <h1 className="text-base font-semibold text-amari-charcoal">Chief of Staff</h1>
        <button
          onClick={handleNewChat}
          disabled={isStreaming || messages.length === 0}
          className="p-2 rounded-lg text-amari-text-muted hover:bg-amari-light-sand disabled:opacity-30 min-w-[40px] min-h-[40px] flex items-center justify-center"
          title="New conversation"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-amari-text-muted text-lg mb-1">Ask me anything.</p>
              <p className="text-amari-text-muted text-sm">Client history, schedule, who owes, what to do next.</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} />
            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-2 space-y-2">
                {msg.actions.map((action) => (
                  <ActionCard key={action.id} action={action} />
                ))}
              </div>
            )}
          </div>
        ))}

        {isStreaming && streamingContent && (
          <MessageBubble message={{ id: 'streaming', role: 'assistant', content: streamingContent, timestamp: Date.now() }} />
        )}
        {isStreaming && !streamingContent && (
          <div className="flex items-center gap-2 px-4 py-3 text-amari-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
