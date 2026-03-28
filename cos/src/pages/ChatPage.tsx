import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { sendMessage } from '../lib/api';
import MessageBubble from '../components/MessageBubble';
import ChatInput from '../components/ChatInput';
import ActionCard from '../components/ActionCard';
import type { ChatMessage, QueuedAction } from '../types/cos';
import { LogOut, RotateCcw } from 'lucide-react';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export default function ChatPage() {
  const { logout } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

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

    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');

    let fullContent = '';

    await sendMessage(
      text,
      image,
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

  return (
    <div className="h-screen h-[100dvh] flex flex-col bg-cos-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-cos-border safe-top">
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
            onClick={logout}
            className="cos-btn-ghost"
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 && !isStreaming && (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center py-20">
              <p className="text-cos-text-muted text-lg mb-1">What's on your mind?</p>
              <p className="text-cos-text-muted text-sm">Brain dump, grocery list, whatever.</p>
            </div>
          </div>
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
