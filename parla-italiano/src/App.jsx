import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import speechService from './speechService'
import { fetchHealth, getAccessCode, sendChat, setAccessCode } from './api'

const TOPICS = [
  { id: 'travel', label: 'Travel' },
  { id: 'cafe', label: 'Caffè' },
  { id: 'food', label: 'Food' },
  { id: 'daily', label: 'Daily life' },
  { id: 'work', label: 'Work' },
  { id: 'free', label: 'Free chat' },
]

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  )
}

export default function App() {
  const [level, setLevel] = useState(() => localStorage.getItem('parla_level') || 'A2')
  const [topic, setTopic] = useState(() => localStorage.getItem('parla_topic') || 'travel')
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('Tap the mic and speak Italian')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [accessRequired, setAccessRequired] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [accessInput, setAccessInput] = useState(getAccessCode())
  const [bootError, setBootError] = useState('')
  const [showInstallTip, setShowInstallTip] = useState(false)
  const startedRef = useRef(false)
  const scrollRef = useRef(null)

  const busy = isRecording || isSpeaking || isProcessing

  const support = useMemo(
    () => ({
      recognition: speechService.isSpeechRecognitionSupported(),
      synthesis: speechService.isSpeechSynthesisSupported(),
    }),
    [],
  )

  useEffect(() => {
    localStorage.setItem('parla_level', level)
  }, [level])

  useEffect(() => {
    localStorage.setItem('parla_topic', topic)
  }, [topic])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, interim])

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
    if (isIos && !isStandalone) setShowInstallTip(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const health = await fetchHealth()
        if (cancelled) return
        if (health.accessRequired) {
          setAccessRequired(true)
          setUnlocked(Boolean(getAccessCode()))
        } else {
          setUnlocked(true)
        }
      } catch (err) {
        if (!cancelled) setBootError(err.message || 'Could not reach Parla API')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const speak = useCallback((text) => {
    if (!support.synthesis) return
    setIsSpeaking(true)
    speechService.speak(
      text,
      'it-IT',
      () => setIsSpeaking(false),
      () => setIsSpeaking(false),
    )
  }, [support.synthesis])

  const startConversation = useCallback(async () => {
    if (startedRef.current || !unlocked) return
    startedRef.current = true
    setIsProcessing(true)
    setStatus('Starting…')
    setError('')
    try {
      const { reply } = await sendChat({
        messages: [
          {
            role: 'user',
            content: `Start a short friendly Italian conversation about ${topic}. One or two sentences, then ask me something easy.`,
          },
        ],
        level,
        topic,
      })
      setMessages([{ role: 'assistant', content: reply }])
      setStatus('Your turn — tap the mic')
      speak(reply)
    } catch (err) {
      startedRef.current = false
      if (err.status === 401) {
        setUnlocked(false)
        setAccessRequired(true)
        setError('Access code required or incorrect.')
      } else {
        setError(err.message)
      }
      setStatus('Could not start')
    } finally {
      setIsProcessing(false)
    }
  }, [level, topic, unlocked, speak])

  useEffect(() => {
    // Restart greeting when level/topic changes (startConversation identity updates).
    startedRef.current = false
    setMessages([])
    speechService.stopSpeaking()
    speechService.stopListening()
    setIsRecording(false)
    setIsSpeaking(false)
    if (unlocked) startConversation()
  }, [unlocked, startConversation])

  const handleUserSpeech = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const nextMessages = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setIsProcessing(true)
    setStatus('Thinking…')
    setError('')

    try {
      const { reply } = await sendChat({
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        level,
        topic,
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
      setStatus('Listening when you are ready')
      speak(reply)
    } catch (err) {
      if (err.status === 401) {
        setUnlocked(false)
        setError('Access code required or incorrect.')
      } else {
        setError(err.message)
      }
      setStatus('Try again')
    } finally {
      setIsProcessing(false)
    }
  }, [messages, level, topic, speak])

  const toggleMic = useCallback(async () => {
    if (isRecording) {
      speechService.stopListening()
      setIsRecording(false)
      setInterim('')
      setStatus('Stopped — tap to speak again')
      return
    }

    if (!support.recognition) {
      setError('Speech recognition needs Chrome or Safari on a phone/desktop.')
      return
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone permission is required. Allow mic access and try again.')
      return
    }

    setError('')
    setStatus('Listening…')
    setIsRecording(true)

    speechService.startListening(
      'it-IT',
      ({ transcript, isFinal }) => {
        if (isFinal) {
          setInterim('')
          setIsRecording(false)
          handleUserSpeech(transcript)
        } else {
          setInterim(transcript)
        }
      },
      (err) => {
        setIsRecording(false)
        setInterim('')
        if (err === 'no-speech') setError('No speech detected — try again a bit closer to the mic.')
        else if (err === 'not-allowed') setError('Microphone blocked. Enable it in browser settings.')
        else if (err === 'unsupported') setError('Speech recognition not supported in this browser.')
        else setError('Could not recognize speech. Try again.')
        setStatus('Tap the mic')
      },
    )
  }, [isRecording, support.recognition, handleUserSpeech])

  const unlock = (e) => {
    e.preventDefault()
    setAccessCode(accessInput.trim())
    setUnlocked(true)
    setError('')
    startedRef.current = false
  }

  if (bootError) {
    return (
      <div className="app-shell">
        <div className="atmosphere" />
        <div className="lock-screen">
          <div className="lock-panel">
            <h1>Parla</h1>
            <p>{bootError}</p>
          </div>
        </div>
      </div>
    )
  }

  if (accessRequired && !unlocked) {
    return (
      <div className="app-shell">
        <div className="atmosphere" />
        <div className="lock-screen">
          <form className="lock-panel" onSubmit={unlock}>
            <h1>Parla</h1>
            <p>Enter your access code to practice Italian.</p>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Access code"
              value={accessInput}
              onChange={(e) => setAccessInput(e.target.value)}
            />
            <button type="submit">Unlock</button>
            {error && <p className="error" style={{ marginTop: '0.75rem' }}>{error}</p>}
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden="true" />
      <div className="frame">
        <header className="brand-block">
          <h1 className="brand">Parla</h1>
          <p className="tagline">Speak Italian. It listens — and answers back.</p>
        </header>

        <div className={`install-banner ${showInstallTip ? 'show' : ''}`}>
          On iPhone: Share → <strong>Add to Home Screen</strong> for the full app feel.
        </div>

        <div className="controls">
          <div className="field">
            <label htmlFor="level">Level</label>
            <select id="level" value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="topic">Topic</label>
            <select id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={busy}>
              {TOPICS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <section className="stage">
          <p className="status">
            {isSpeaking ? 'Parla is speaking…' : isProcessing ? 'Thinking…' : status}
          </p>

          <div className={`mic-wrap ${isRecording ? 'listening' : ''}`}>
            <button
              type="button"
              className={`mic ${isRecording ? 'listening' : ''}`}
              onClick={toggleMic}
              disabled={isSpeaking || isProcessing}
              aria-label={isRecording ? 'Stop listening' : 'Start listening'}
            >
              <MicIcon />
            </button>
          </div>

          <p className="interim">{interim || '\u00A0'}</p>
          {error && <p className="error">{error}</p>}
          {!support.recognition && (
            <p className="error">
              This browser cannot do speech recognition. On Android use Chrome; on iPhone use Safari.
            </p>
          )}
        </section>

        <div className="transcript" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
              <span className="who">{m.role === 'user' ? 'You' : 'Parla'}</span>
              {m.content}
            </div>
          ))}
        </div>

        <p className="hint">Tap mic → speak Italian → hear the reply. Works best on your phone over HTTPS.</p>
      </div>
    </div>
  )
}
