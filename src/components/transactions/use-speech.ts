"use client";

import * as React from "react";

/* Minimal typings for the Web Speech API (Chrome, Edge, Safari). */
type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string; confidence: number } };
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow the microphone for this site and try again.",
  "service-not-allowed": "Speech recognition is not allowed in this browser.",
  "no-speech": "No speech was detected. Try again and speak clearly.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs a network connection.",
};

/**
 * Browsers only allow the microphone on https:// pages and on localhost. On a
 * plain http network address (http://192.168.1.20:3000) recognition fails with a
 * vague "not-allowed", so explain the real reason up front.
 */
export function insecureVoiceMessage(): string | null {
  if (typeof window === "undefined" || window.isSecureContext) return null;
  return `Voice input needs a secure connection — browsers block the microphone on ${window.location.origin}. Open the site with an https:// address (or http://localhost on the computer running it). You can type instead.`;
}

/**
 * Browser speech-to-text. Audio is processed by the browser's built-in speech
 * service; VLedger only receives the resulting text.
 */
export function useSpeechRecognition(lang = "en-IN") {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [interim, setInterim] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const recRef = React.useRef<SpeechRecognitionLike | null>(null);
  const finalRef = React.useRef("");

  React.useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()));
    return () => recRef.current?.abort();
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Voice input is not supported in this browser. Use Chrome, Edge or Safari, or type instead.");
      return;
    }
    const blocked = insecureVoiceMessage();
    if (blocked) {
      setError(blocked);
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    finalRef.current = "";
    setTranscript("");
    setInterim("");
    setError(null);
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current = `${finalRef.current} ${r[0].transcript}`.trim();
        else interimText += r[0].transcript;
      }
      setTranscript(finalRef.current);
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted") setError(ERROR_MESSAGES[e.error] ?? `Voice input error: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("Could not start the microphone.");
    }
  }, [lang]);

  const stop = React.useCallback(() => {
    recRef.current?.stop();
  }, []);

  const reset = React.useCallback(() => {
    finalRef.current = "";
    setTranscript("");
    setInterim("");
    setError(null);
  }, []);

  return { supported, listening, transcript, interim, error, start, stop, reset, setTranscript };
}
