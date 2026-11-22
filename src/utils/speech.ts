/**
 * Graceful Web Speech API helpers for low-literacy accessibility:
 * - SpeechRecognition (Mic input in English / Urdu)
 * - speechSynthesis (Read-Aloud in English / Urdu)
 */

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceInputSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function isReadAloudSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function startVoiceDictation(params: {
  lang: 'en-US' | 'ur-PK';
  onTranscript: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}): (() => void) | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    params.onError('Voice input is not supported in this browser. Please paste or type the message.');
    return null;
  }

  try {
    const rec = new Ctor();
    rec.lang = params.lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const first = event.results?.[0]?.[0]?.transcript;
      if (first) params.onTranscript(first);
    };
    rec.onerror = (event) => {
      params.onError(
        event.error === 'not-allowed'
          ? 'Microphone permission denied. You can paste or type the message instead.'
          : `Voice dictation could not complete (${event.error}).`
      );
    };
    rec.onend = () => params.onEnd();
    rec.start();
    return () => {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    };
  } catch {
    params.onError('Unable to start microphone right now. Please type or paste the message.');
    return null;
  }
}

export function speakExplanation(text: string, lang: 'en-US' | 'ur-PK'): boolean {
  if (!isReadAloudSupported()) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.94;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  if (!isReadAloudSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
