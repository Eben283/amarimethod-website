/** Web Speech API helper — adapted from kenoleeee/italk (MIT). */

const SPEECH_CODES = {
  it: 'it-IT',
  en: 'en-US',
}

class SpeechService {
  constructor() {
    this.recognition = null
    this.synthesis = typeof window !== 'undefined' ? window.speechSynthesis : null
    this.isListening = false
    this.voices = []

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
    if (this.recognition && this.isListening) {
      this.recognition.stop()
      this.isListening = false
    }
  }

  speak(text, language = 'it-IT', onEnd, onError) {
    if (!this.synthesis) {
      onError?.('unsupported')
      return
    }

    this.synthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.volume = 1

    const langPrefix = language.split('-')[0]
    const italianVoices = this.voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix))
    const preferred =
      italianVoices.find((v) => /female|elsa|alice|paulina|sara/i.test(v.name)) ||
      italianVoices[0]
    if (preferred) utterance.voice = preferred

    utterance.onend = () => onEnd?.()
    utterance.onerror = (event) => onError?.(event.error)
    this.synthesis.speak(utterance)
  }

  stopSpeaking() {
    this.synthesis?.cancel()
  }

  isSpeechRecognitionSupported() {
    return Boolean(this.recognition)
  }

  isSpeechSynthesisSupported() {
    return Boolean(this.synthesis)
  }

  getLanguageCode(key = 'it') {
    return SPEECH_CODES[key] || 'it-IT'
  }
}

export default new SpeechService()
