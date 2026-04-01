import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Camera, Image, X, Mic, MicOff } from 'lucide-react';

interface Props {
  onSend: (message: string, image?: string) => void;
  disabled: boolean;
}

// Speech recognition — Web Speech API with cross-browser support
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionInstance = any;

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported] = useState(() => !!getSpeechRecognition());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef('');
  const autoSendRef = useRef(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  // Clean up speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, []);

  // Re-start listening after a response comes back (hands-free mode)
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (prevDisabledRef.current && !disabled && autoSendRef.current) {
      // Response just finished — restart listening for hands-free mode
      startListening();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return;

    // Clean up any existing instance
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;
    transcriptRef.current = '';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        transcriptRef.current += finalTranscript;
      }

      // Show current transcript in textarea
      const display = transcriptRef.current + interimTranscript;
      setText(display);

      // Reset silence timer on any speech activity
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      // Auto-send after 1.5s of silence (for driving hands-free)
      if (transcriptRef.current.trim()) {
        silenceTimerRef.current = setTimeout(() => {
          const finalText = transcriptRef.current.trim();
          if (finalText && !disabled) {
            recognition.stop();
            autoSendRef.current = true;
            onSend(finalText);
            setText('');
            transcriptRef.current = '';
          }
        }, 1500);
      }
    };

    recognition.onend = () => {
      // If we didn't auto-send, just stop listening
      if (!autoSendRef.current) {
        setIsListening(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setIsListening(false);
        autoSendRef.current = false;
      }
    };

    recognition.start();
    setIsListening(true);
  }, [disabled, onSend]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    setIsListening(false);
    autoSendRef.current = false;
    transcriptRef.current = '';
  }, []);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  function handleSubmit() {
    const trimmed = text.trim();
    if ((!trimmed && !imageBase64) || disabled) return;

    // Stop listening if active (manual send overrides auto-send)
    if (isListening) {
      stopListening();
    }

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

      {/* Voice listening indicator */}
      {isListening && (
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-cos-text-secondary">Listening... speak naturally</span>
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

        {/* Voice button */}
        {voiceSupported && (
          <button
            onClick={toggleVoice}
            disabled={disabled && !isListening}
            className={`shrink-0 ${isListening ? 'cos-btn-ghost text-red-500' : 'cos-btn-ghost'} disabled:opacity-30`}
            title={isListening ? 'Stop listening' : 'Voice input'}
          >
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        )}

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
          placeholder={isListening ? 'Listening...' : 'What\'s on your mind...'}
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
