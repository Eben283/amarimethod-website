import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Camera, Image, X, Mic, MicOff } from 'lucide-react';

interface Props {
  onSend: (message: string, image?: string) => void;
  disabled: boolean;
}

const GHOST = 'p-2 rounded-lg text-amari-text-muted hover:bg-amari-light-sand min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0';
const ACCENT = 'p-2 rounded-lg bg-amari-charcoal text-white min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0';

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

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (prevDisabledRef.current && !disabled && autoSendRef.current) startListening();
    prevDisabledRef.current = disabled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return;
    if (recognitionRef.current) recognitionRef.current.abort();

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
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interimTranscript += result[0].transcript;
      }
      if (finalTranscript) transcriptRef.current += finalTranscript;
      setText(transcriptRef.current + interimTranscript);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
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
    recognition.onend = () => { if (!autoSendRef.current) setIsListening(false); };
    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setIsListening(false);
        autoSendRef.current = false;
      }
    };
    recognition.start();
    setIsListening(true);
  }, [disabled, onSend]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) recognitionRef.current.abort();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    setIsListening(false);
    autoSendRef.current = false;
    transcriptRef.current = '';
  }, []);

  const toggleVoice = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  function handleSubmit() {
    const trimmed = text.trim();
    if ((!trimmed && !imageBase64) || disabled) return;
    if (isListening) stopListening();
    onSend(trimmed || "What's in this image?", imageBase64 || undefined);
    setText('');
    setImagePreview(null);
    setImageBase64(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 1024;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = (height / width) * maxSize; width = maxSize; }
          else { width = (width / height) * maxSize; height = maxSize; }
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
    e.target.value = '';
  }

  function clearImage() {
    setImagePreview(null);
    setImageBase64(null);
  }

  return (
    <div className="border-t border-amari-border px-4 py-3 bg-white">
      {imagePreview && (
        <div className="mb-2 relative inline-block">
          <img src={imagePreview} alt="Attached" className="h-20 rounded-lg border border-amari-border" />
          <button onClick={clearImage} className="absolute -top-2 -right-2 bg-white border border-amari-border rounded-full p-0.5">
            <X className="w-3.5 h-3.5 text-amari-text-muted" />
          </button>
        </div>
      )}

      {isListening && (
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-amari-text-muted">Listening… speak naturally</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button onClick={() => cameraInputRef.current?.click()} disabled={disabled} className={`${GHOST} disabled:opacity-30`} title="Take photo">
          <Camera className="w-5 h-5" />
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={disabled} className={`${GHOST} disabled:opacity-30`} title="Attach image">
          <Image className="w-5 h-5" />
        </button>
        {voiceSupported && (
          <button onClick={toggleVoice} disabled={disabled && !isListening} className={`${GHOST} ${isListening ? 'text-red-500' : ''} disabled:opacity-30`} title={isListening ? 'Stop listening' : 'Voice input'}>
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        )}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} className="hidden" />
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? 'Listening…' : "Ask about a practice member, schedule, anything…"}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-amari-border px-3 py-2 text-[15px] focus:outline-none focus:border-amari-accent-warm"
          inputMode="text"
          autoComplete="off"
          autoCorrect="on"
        />
        <button onClick={handleSubmit} disabled={disabled || (!text.trim() && !imageBase64)} className={`${ACCENT} disabled:opacity-30`}>
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
