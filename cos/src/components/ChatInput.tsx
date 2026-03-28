import { useState, useRef, useEffect } from 'react';
import { Send, Camera, Image, X } from 'lucide-react';

interface Props {
  onSend: (message: string, image?: string) => void;
  disabled: boolean;
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  function handleSubmit() {
    const trimmed = text.trim();
    if ((!trimmed && !imageBase64) || disabled) return;
    onSend(trimmed || "What's in this image?", imageBase64 || undefined);
    setText('');
    setImagePreview(null);
    setImageBase64(null);
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

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Resize and convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 1024;
        let { width, height } = img;

        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height / width) * maxSize;
            width = maxSize;
          } else {
            width = (width / height) * maxSize;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          setImagePreview(base64);
          setImageBase64(base64);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be selected again
    e.target.value = '';
  }

  function clearImage() {
    setImagePreview(null);
    setImageBase64(null);
  }

  return (
    <div className="border-t border-cos-border px-4 py-3 safe-bottom bg-cos-bg">
      {/* Image preview */}
      {imagePreview && (
        <div className="mb-2 relative inline-block">
          <img
            src={imagePreview}
            alt="Attached"
            className="h-20 rounded-lg border border-cos-border"
          />
          <button
            onClick={clearImage}
            className="absolute -top-2 -right-2 bg-cos-surface border border-cos-border rounded-full p-0.5"
          >
            <X className="w-3.5 h-3.5 text-cos-text-secondary" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Camera button */}
        <button
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled}
          className="cos-btn-ghost disabled:opacity-30 shrink-0"
          title="Take photo"
        >
          <Camera className="w-5 h-5" />
        </button>

        {/* Gallery button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="cos-btn-ghost disabled:opacity-30 shrink-0"
          title="Attach image"
        >
          <Image className="w-5 h-5" />
        </button>

        {/* Hidden file inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageSelect}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />

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
          disabled={disabled || (!text.trim() && !imageBase64)}
          className="cos-btn-accent disabled:opacity-30 shrink-0"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
