import type { ChatMessage } from '../../types/cos';

interface Props {
  message: ChatMessage;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-amari-accent-warm text-white rounded-br-md'
            : 'bg-white text-amari-charcoal border border-amari-border rounded-bl-md'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
