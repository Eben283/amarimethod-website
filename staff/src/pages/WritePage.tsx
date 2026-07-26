import { useState, useRef, useEffect, useCallback } from 'react';
import { RotateCcw, Loader2, Copy, Check, AlertTriangle } from 'lucide-react';
import { sendVoiceWrite, type VoiceWriteResult } from '../lib/cosApi';
import MessageBubble from '../components/cos/MessageBubble';
import ChatInput from '../components/cos/ChatInput';
import type { ChatMessage } from '../types/cos';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

type WriteMeta = Omit<VoiceWriteResult, 'copy'>;
type WriteMessage = ChatMessage & { meta?: WriteMeta };

// Small footer under a generated draft: channel, how it was checked, a copy button,
// and an honest warning when the engine couldn't fully verify it.
function DraftFooter({ copy, meta }: { copy: string; meta: WriteMeta }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(copy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [copy]);

  return (
    <div className="mt-1.5 ml-1 space-y-1">
      <div className="flex items-center gap-2 text-xs text-amari-text-muted">
        <button
          onClick={onCopy}
          className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-amari-light-sand transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="capitalize">{meta.channel !== 'unknown' ? meta.channel : 'copy'}</span>
        {meta.passedClean ? (
          <span className="text-emerald-600">on-brand ✓</span>
        ) : (
          <span className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="w-3.5 h-3.5" /> give this one a read
          </span>
        )}
      </div>
      {meta.fixes.length > 0 && (
        <details className="text-xs text-amari-text-muted">
          <summary className="cursor-pointer select-none">what I cleaned ({meta.fixes.length})</summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            {meta.fixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function WritePage() {
  const [messages, setMessages] = useState<WriteMessage[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isWorking]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isWorking) return;

      const userMessage: WriteMessage = {
        id: generateId(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      // History for iteration ("make it shorter") — prior turns as plain role/content.
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMessage]);
      setIsWorking(true);

      try {
        const result = await sendVoiceWrite(text, history);
        const { copy, ...meta } = result;
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: 'assistant', content: copy, timestamp: Date.now(), meta },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: `Something went wrong: ${err instanceof Error ? err.message : 'unknown error'}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsWorking(false);
      }
    },
    [isWorking, messages],
  );

  const handleNewChat = useCallback(() => {
    if (isWorking) return;
    setMessages([]);
  }, [isWorking]);

  return (
    <div className="flex flex-col" style={{ height: '100dvh' }}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-amari-border">
        <h1 className="text-base font-semibold text-amari-charcoal">Voice Writer</h1>
        <button
          onClick={handleNewChat}
          disabled={isWorking || messages.length === 0}
          className="p-2 rounded-lg text-amari-text-muted hover:bg-amari-light-sand disabled:opacity-30 min-w-[40px] min-h-[40px] flex items-center justify-center"
          title="Start over"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isWorking && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6">
              <p className="text-amari-text-muted text-lg mb-1">What are we writing?</p>
              <p className="text-amari-text-muted text-sm">
                Describe the copy, or paste a draft to de-slop. SMS, email, site, ad, outreach.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} />
            {msg.role === 'assistant' && msg.meta && <DraftFooter copy={msg.content} meta={msg.meta} />}
          </div>
        ))}

        {isWorking && (
          <div className="flex items-center gap-2 px-4 py-3 text-amari-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Writing and checking it against the voice standard…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput onSend={handleSend} disabled={isWorking} />
    </div>
  );
}
