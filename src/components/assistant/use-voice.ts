"use client";

import * as React from "react";
import { insecureVoiceMessage } from "@/components/transactions/use-speech";

// ───────────────────────── Text-to-speech: a soft female voice ─────────────────────────

const FEMALE_HINTS = [
  /neerja/i, // Microsoft Neerja (en-IN, natural)
  /aria/i,
  /jenny/i,
  /sonia/i,
  /libby/i,
  /heera/i, // Microsoft Heera (en-IN)
  /swara/i,
  /ava\b/i,
  /emma/i,
  /michelle/i,
  /natasha/i,
  /clara/i,
  /zira/i,
  /hazel/i,
  /susan/i,
  /catherine/i,
  /samantha/i,
  /veena/i,
  /karen/i,
  /moira/i,
  /tessa/i,
  /fiona/i,
  /serena/i,
  /victoria/i,
  /allison/i,
  /google uk english female/i,
  /google us english/i,
  /female/i,
  /woman/i,
];
const MALE_HINTS = [
  /\bmale\b/i,
  /david/i,
  /mark/i,
  /ravi/i,
  /prabhat/i,
  /hemant/i,
  /madhur/i,
  /guy/i,
  /ryan/i,
  /george/i,
  /james/i,
  /daniel/i,
  /\balex\b/i,
  /fred/i,
  /thomas/i,
  /brian/i,
  /christopher/i,
  /eric/i,
  /roger/i,
  /steffan/i,
  /william/i,
  /liam/i,
  /andrew/i,
  /aaron/i,
  /rishi/i,
  /google uk english male/i,
];

function femaleScore(v: SpeechSynthesisVoice): number {
  const name = `${v.name} ${v.voiceURI}`;
  if (MALE_HINTS.some((r) => r.test(name))) return -1000;
  const idx = FEMALE_HINTS.findIndex((r) => r.test(name));
  let score = idx === -1 ? 0 : 100 - idx * 2;
  if (/natural|neural|online|enhanced|premium/i.test(name)) score += 25;
  if (/^en-IN/i.test(v.lang)) score += 12;
  else if (/^en/i.test(v.lang)) score += 8;
  else score -= 200;
  return score;
}

export type VoiceOption = { name: string; lang: string; female: boolean };

const PREF_KEY = "vl.assistant.voice";
const MUTE_KEY = "vl.assistant.muted";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readPref(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/**
 * Browser speech synthesis with a gentle female voice: female voices are ranked
 * first (natural/neural voices preferred, Indian English first), spoken a touch
 * slower with a slightly raised pitch so it never sounds harsh.
 */
export function useAssistantVoice() {
  const [supported, setSupported] = React.useState(false);
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = React.useState<string | null>(null);
  const [muted, setMutedState] = React.useState(false);
  const [speaking, setSpeaking] = React.useState(false);
  const fallbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    setMutedState(readPref(MUTE_KEY) === "1");
    const load = () => {
      const list = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
      setVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);

  const ranked = React.useMemo(() => [...voices].sort((a, b) => femaleScore(b) - femaleScore(a)), [voices]);

  const voice = React.useMemo(() => {
    const saved = voiceName ?? readPref(PREF_KEY);
    return (saved && ranked.find((v) => v.name === saved)) || ranked.find((v) => femaleScore(v) > 0) || ranked[0] || null;
  }, [ranked, voiceName]);

  const options: VoiceOption[] = React.useMemo(
    () => ranked.map((v) => ({ name: v.name, lang: v.lang, female: femaleScore(v) > 0 })),
    [ranked],
  );

  const chooseVoice = React.useCallback((name: string) => {
    setVoiceName(name);
    writePref(PREF_KEY, name);
  }, []);

  const setMuted = React.useCallback((m: boolean) => {
    setMutedState(m);
    writePref(MUTE_KEY, m ? "1" : "0");
    if (m && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // Chrome can garbage-collect an utterance before it plays (no audio, no events),
  // so every queued utterance is kept referenced until it finishes.
  const live = React.useRef<SpeechSynthesisUtterance[]>([]);
  const speakId = React.useRef(0);
  const [audioIssue, setAudioIssue] = React.useState(false);

  const stop = React.useCallback(() => {
    speakId.current++;
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  /** Speaks `text`; resolves when finished (or immediately when muted/unsupported). */
  const speak = React.useCallback(
    async (text: string): Promise<void> => {
      if (!supported || muted || !text.trim()) return;
      const synth = window.speechSynthesis;
      const id = ++speakId.current;
      // "₹2,500" reads better as "2,500 rupees".
      const spoken = text.replace(/₹\s?([\d,]+(?:\.\d+)?)/g, "$1 rupees").replace(/₹/g, "rupees ");

      // Cancelling and speaking in the same instant makes Chrome drop the new
      // utterance silently, so give the engine a moment after a cancel.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        await sleep(150);
      }
      if (id !== speakId.current) return;

      const savedName = voiceName ?? readPref(PREF_KEY) ?? voice?.name ?? null;
      const attempt = (useChosenVoice: boolean) =>
        new Promise<"ok" | "nostart">((res) => {
          const u = new SpeechSynthesisUtterance(spoken);
          // Resolve the voice from the current list — stale voice objects can be silent.
          const current = useChosenVoice && savedName ? synth.getVoices().find((v) => v.name === savedName) : undefined;
          if (current) {
            u.voice = current;
            u.lang = current.lang;
          } else {
            u.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
          }
          u.rate = 0.96;
          u.pitch = 1.08;
          u.volume = 1;
          let started = false;
          let settled = false;
          const done = (r: "ok" | "nostart") => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
            live.current = live.current.filter((x) => x !== u);
            res(r);
          };
          u.onstart = () => {
            started = true;
            setAudioIssue(false);
          };
          u.onend = () => done("ok");
          u.onerror = () => done(started ? "ok" : "nostart");
          live.current.push(u);
          // If playback hasn't started within 2.5 s it was dropped or blocked.
          const watchdog = setTimeout(() => {
            if (!started) {
              synth.cancel();
              done("nostart");
            }
          }, 2500);
          // Some browsers skip `onend`; never leave the conversation waiting.
          fallbackTimer.current = setTimeout(() => done("ok"), Math.min(25_000, 3000 + spoken.length * 90));
          synth.resume(); // Chrome on Windows can be left in a paused state
          synth.speak(u);
        });

      setSpeaking(true);
      let result = await attempt(true);
      if (result === "nostart" && id === speakId.current) {
        // Retry once with the browser's default voice.
        await sleep(150);
        if (id === speakId.current) result = await attempt(false);
      }
      if (id === speakId.current) {
        setSpeaking(false);
        if (result === "nostart") setAudioIssue(true);
      }
    },
    [supported, muted, voice, voiceName],
  );

  return { supported, speaking, speak, stop, muted, setMuted, voice, options, chooseVoice, audioIssue };
}

// ───────────────────────── Speech-to-text: one answer at a time ─────────────────────────

type RecognitionAlternative = { transcript: string; confidence: number };
type RecognitionResult = { isFinal: boolean; length: number; [index: number]: RecognitionAlternative };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
};

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow the microphone for this site, or type your answer.",
  "service-not-allowed": "Voice input isn't allowed in this browser. Type your answer instead.",
  "audio-capture": "No microphone was found. Type your answer instead.",
  network: "Voice recognition needs an internet connection.",
};

export const LISTEN_LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-AU", label: "English (Australia)" },
] as const;
const LISTEN_LANG_KEY = "vl.assistant.listenLang";

export function readListenLanguage() {
  return readPref(LISTEN_LANG_KEY) || "en-IN";
}
export function writeListenLanguage(lang: string) {
  writePref(LISTEN_LANG_KEY, lang);
}

let chimeCtx: AudioContext | null = null;
/** A soft two-note chime so people know exactly when to start speaking. */
function playReadyChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    chimeCtx ??= new Ctx();
    const ctx = chimeCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.09;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.07, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch {}
}

export type HeardAnswer = { text: string; alternatives: string[] };

/**
 * Listens for one spoken answer. It keeps listening through short pauses
 * ("fifteen thousand … five hundred") and stops about 1.3 s after the person
 * stops talking. It asks the recogniser for several guesses so the caller can
 * pick the one that makes sense for the question. A chime plays the moment the
 * microphone is actually capturing, so the first word isn't lost.
 */
export function useAnswerListener() {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [interim, setInterim] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const rec = React.useRef<RecognitionLike | null>(null);

  React.useEffect(() => {
    setSupported(Boolean(recognitionCtor()));
    return () => rec.current?.abort();
  }, []);

  const cancel = React.useCallback(() => {
    rec.current?.abort();
    rec.current = null;
    setListening(false);
    setReady(false);
    setInterim("");
  }, []);

  const listen = React.useCallback(
    (opts: { chime?: boolean } = {}) =>
      new Promise<HeardAnswer | null>((resolve) => {
        const Ctor = recognitionCtor();
        if (!Ctor) return resolve(null);
        const blocked = insecureVoiceMessage();
        if (blocked) {
          setError(blocked);
          return resolve(null);
        }
        rec.current?.abort();
        const r = new Ctor();
        r.lang = readListenLanguage();
        r.continuous = true;
        r.interimResults = true;
        r.maxAlternatives = 5;

        const finals: string[][] = []; // alternatives for each final segment
        let settled = false;
        let heardSomething = false;
        let silenceTimer: ReturnType<typeof setTimeout> | null = null;

        const stopNow = () => {
          try {
            r.stop();
          } catch {
            finish();
          }
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          clearTimeout(noSpeechTimer);
          clearTimeout(hardCap);
          setListening(false);
          setReady(false);
          setInterim("");
          if (!finals.length) return resolve(null);
          const best = finals
            .map((alts) => alts[0])
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          // One segment: offer every alternative. Several: the combined top
          // guesses, plus each alternative of the last segment.
          const alternatives =
            finals.length === 1
              ? finals[0]
              : [best, ...finals[finals.length - 1].slice(1).map((alt) => [...finals.slice(0, -1).map((f) => f[0]), alt].join(" "))];
          resolve({ text: best, alternatives: [...new Set(alternatives.map((a) => a.replace(/\s+/g, " ").trim()).filter(Boolean))] });
        };
        const stopSoon = (ms: number) => {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(stopNow, ms);
        };

        r.onaudiostart = () => {
          setReady(true);
          if (opts.chime !== false) playReadyChime();
        };
        r.onspeechstart = () => {
          heardSomething = true;
        };
        r.onresult = (e) => {
          let partial = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) {
              const alts: string[] = [];
              for (let j = 0; j < res.length; j++) if (res[j]?.transcript) alts.push(res[j].transcript.trim());
              if (alts.length) finals.push(alts);
            } else {
              partial += res[0]?.transcript ?? "";
            }
          }
          heardSomething = true;
          const soFar = finals.map((f) => f[0]).join(" ");
          setInterim(`${soFar} ${partial}`.trim());
          // A pause after a finished phrase ends the answer; mid-phrase, wait longer.
          stopSoon(partial ? 2200 : 1300);
        };
        r.onerror = (e) => {
          if (e.error !== "aborted" && e.error !== "no-speech") setError(MIC_ERRORS[e.error] ?? `Voice input error: ${e.error}`);
        };
        r.onend = finish;

        // Nothing said within 8 s: stop quietly. Never listen for more than 25 s.
        const noSpeechTimer = setTimeout(() => {
          if (!heardSomething) stopNow();
        }, 8000);
        const hardCap = setTimeout(stopNow, 25_000);

        rec.current = r;
        setError(null);
        try {
          r.start();
          setListening(true);
        } catch {
          finish();
        }
      }),
    [],
  );

  return { supported, listening, ready, interim, error, listen, cancel };
}

