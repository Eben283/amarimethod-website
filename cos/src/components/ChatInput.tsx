import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-cos-border px-4 py-3 safe-bottom bg-cos-bg">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind..."
          disabled={disabled}
          rows={1}
          className="cos-input flex-1"
          inputMode="text"
          autoComplete="off"
          autoCorrect="on"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="cos-btn-accent disabled:opacity-30 shrink-0"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
