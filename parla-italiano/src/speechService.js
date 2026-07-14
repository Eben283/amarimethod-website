/** Playback helper: server Italian TTS (reliable on phones) + Web Speech fallback. */

import { fetchSpeechAudio } from './api'

const SPEECH_CODES = {
  it: 'it-IT',
  en: 'en-US',
}

// Minimal valid silent MP3 — unlocks mobile Audio() on a user gesture.
const SILENT_MP3 =
  'data:audio/mpeg;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4Ljc2AAAAAAAAAAAAAAAAJAAAAAAAAAAAA3DVysiLQAAAAAAAAAAAAAAAAAAAA//uQZAAAD4AXY/wAAIgAANIAAAATM/AAAA/+5BkAAAPgBdj/AAAiAAA0gAAABMz8AAA'

class SpeechService {
  constructor() {
    this.recognition = null
    this.synthesis = typeof window !== 'undefined' ? window.speechSynthesis : null
    this.isListening = false
    this.voices = []
    this.audio = typeof window !== 'undefined' ? new Audio() : null
    this.audioUnlocked = false
    this.objectUrl = null
    this._endedTimer = null

    if (typeof window !== 'undefined') {
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
        this.recognition = new SpeechRecognition()
        this.recognition.continuous = false
        this.recognition.interimResults = true
        this.recognition.maxAlternatives = 1
      }

      this.loadVoices()
      if (this.synthesis && this.synthesis.onvoiceschanged !== undefined) {
        this.synthesis.onvoiceschanged = () => this.loadVoices()
      }
    }
  }

  loadVoices() {
    if (!this.synthesis) return
    this.voices = this.synthesis.getVoices()
  }

  /** Call from a tap/click so iOS/Android allow later Audio playback. */
  async unlock() {
    if (!this.audio || this.audioUnlocked) return
    try {
      this.audio.src = SILENT_MP3
      this.audio.volume = 0.01
      await this.audio.play()
      this.audio.pause()
      this.audio.currentTime = 0
      this.audio.volume = 1
      this.audioUnlocked = true
    } catch {
      // Still mark attempted; a later mic tap may succeed.
      this.audioUnlocked = true
    }
  }

  startListening(language = 'it-IT', onResult, onError) {
    if (!this.recognition) {
      onError?.('unsupported')
      return
    }

    this.recognition.lang = language
    this.isListening = true

    this.recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1]
      onResult?.({
        transcript: result[0].transcript,
        isFinal: result.isFinal,
      })
    }

    this.recognition.onerror = (event) => {
      this.isListening = false
      onError?.(event.error)
    }

    this.recognition.onend = () => {
      this.isListening = false
    }

    try {
      this.recognition.start()
    } catch (error) {
      this.isListening = false
      onError?.(error?.message || 'start-failed')
    }
  }

  stopListening() {
    if (!this.recognition || !this.isListening) return
    this.isListening = false
    try {
      if (typeof this.recognition.abort === 'function') this.recognition.abort()
      else this.recognition.stop()
    } catch {
      try {
        this.recognition.stop()
      } catch {
        /* already stopped */
      }
    }
  }

  _clearObjectUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  _finish(onEnd) {
    if (this._endedTimer) {
      clearTimeout(this._endedTimer)
      this._endedTimer = null
    }
    onEnd?.()
  }

  async speak(text, language = 'it-IT', onEnd, onError) {
    const cleaned = String(text || '').trim()
    if (!cleaned) {
      onEnd?.()
      return
    }

    this.stopSpeaking()
    await this.unlock()

    // Primary path: real MP3 from worker (works on phones after unlock).
    try {
      const url = await fetchSpeechAudio(cleaned)
      this.objectUrl = url
      if (!this.audio) throw new Error('no-audio-element')
      this.audio.src = url
      this.audio.onended = () => {
        this._clearObjectUrl()
        this._finish(onEnd)
      }
      this.audio.onerror = () => {
        this._clearObjectUrl()
        this._speakWeb(cleaned, language, onEnd, onError)
      }
      // Safety: never leave UI stuck on "speaking"
      this._endedTimer = setTimeout(() => this._finish(onEnd), Math.min(60000, 4000 + cleaned.length * 80))
      await this.audio.play()
      return
    } catch (err) {
      // Fall through to Web Speech
      this._speakWeb(cleaned, language, onEnd, (e) => onError?.(e || err?.message || 'speak-failed'))
    }
  }

  _speakWeb(text, language, onEnd, onError) {
    if (!this.synthesis) {
      onError?.('unsupported')
      onEnd?.()
      return
    }

    try {
      this.synthesis.cancel()
    } catch {
      /* ignore */
    }

    const utter = () => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = language
      utterance.rate = 0.9
      utterance.pitch = 1
      utterance.volume = 1

      const langPrefix = language.split('-')[0]
      const italianVoices = this.voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix))
      const preferred =
        italianVoices.find((v) => /female|elsa|alice|paulina|sara|italian/i.test(v.name)) ||
        italianVoices[0]
      if (preferred) utterance.voice = preferred

      utterance.onend = () => this._finish(onEnd)
      utterance.onerror = (event) => {
        onError?.(event.error)
        this._finish(onEnd)
      }

      this._endedTimer = setTimeout(() => this._finish(onEnd), Math.min(60000, 4000 + text.length * 90))
      this.synthesis.speak(utterance)
    }

    // iOS often needs a beat after cancel() / before voices are ready.
    this.loadVoices()
    setTimeout(utter, 60)
  }

  stopSpeaking() {
    if (this._endedTimer) {
      clearTimeout(this._endedTimer)
      this._endedTimer = null
    }
    if (this.audio) {
      try {
        this.audio.pause()
        this.audio.removeAttribute('src')
        this.audio.load()
      } catch {
        /* ignore */
      }
    }
    this._clearObjectUrl()
    try {
      this.synthesis?.cancel()
    } catch {
      /* ignore */
    }
  }

  isSpeechRecognitionSupported() {
    return Boolean(this.recognition)
  }

  isSpeechSynthesisSupported() {
    return Boolean(this.audio || this.synthesis)
  }

  getLanguageCode(key = 'it') {
    return SPEECH_CODES[key] || 'it-IT'
  }
}

export default new SpeechService()
