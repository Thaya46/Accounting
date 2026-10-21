"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Pencil,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch, ClientApiError } from "@/lib/client/api";
import { parseYesNo } from "@/lib/ai/parser";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { useSpeechRecognition } from "@/components/transactions/use-speech";
import { startNavigationProgress } from "@/components/shell/navigation-progress";
import { LISTEN_LANGUAGES, readListenLanguage, useAnswerListener, useAssistantVoice, writeListenLanguage, type HeardAnswer } from "./use-voice";
import {
  EDITABLE_FIELDS,
  clearField,
  interpret,
  needsApproval,
  nextStep,
  progress,
  question,
  summary,
  summaryRows,
  toTransactionInput,
  type AssistantContext,
  type Chip,
  type Draft,
  type StepId,
} from "./flow";

type Mode = "choose" | "sentence" | "interactive";
type Message = { id: number; role: "assistant" | "user"; text: string; tone?: "error" | "success" };
type Saved = { id: string; ref: string; status: string };
type Intent = "post" | "submit" | "draft";

const STATUS_TEXT: Record<string, string> = {
  POSTED: "posted to the ledger",
  PENDING_APPROVAL: "submitted for approval",
  DRAFT: "saved as a draft",
};

let messageId = 0;

/** Floating AI & Voice Entry assistant, available on every workspace page. */
export function AssistantLauncher({ workspaceId, canPost }: { workspaceId: string; canPost: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("choose");
  const [showSettings, setShowSettings] = React.useState(false);
  const voice = useAssistantVoice();
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Close on Escape; stop speaking when the panel closes.
  React.useEffect(() => {
    if (!open) {
      voice.stop();
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unlockSpeech = () => {
    // iOS Safari only plays speech that starts inside a tap, so prime it with a
    // silent utterance there. Desktop browsers don't need this.
    try {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios && "speechSynthesis" in window && !voice.muted) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch {}
  };

  return (
    <div className="print:hidden">
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            key="panel"
            role="dialog"
            aria-modal="false"
            aria-label="AI & Voice Entry assistant"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ transformOrigin: "bottom right" }}
            className="fixed inset-x-3 bottom-[5.5rem] z-50 flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-3xl border border-border/80 bg-card shadow-pop sm:inset-x-auto sm:right-6 sm:w-[410px] sm:max-h-[min(680px,calc(100dvh-8rem))]"
          >
            <PanelHeader
              mode={mode}
              voice={voice}
              showSettings={showSettings}
              onToggleSettings={() => setShowSettings((s) => !s)}
              onBack={mode !== "choose" ? () => setMode("choose") : undefined}
              onClose={() => setOpen(false)}
            />
            {showSettings && <VoiceSettings voice={voice} onDone={() => setShowSettings(false)} />}
            {voice.audioIssue && !voice.muted && !showSettings && (
              <div role="status" className="flex items-start gap-2.5 border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-foreground">
                <VolumeX className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Your browser didn&apos;t play my voice.</p>
                  <p className="mt-0.5 text-muted-foreground">Check your speaker volume and that this tab isn&apos;t muted, then try again — or pick another voice in settings. You can keep going by reading and typing.</p>
                </div>
                <button onClick={() => void voice.speak("Hi! Can you hear me now?")} className="shrink-0 rounded-full border border-warning/40 px-2.5 py-1 font-medium hover:bg-card/70">
                  Try again
                </button>
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              {mode === "choose" && (
                <ModeChooser
                  onSentence={() => setMode("sentence")}
                  onInteractive={() => {
                    unlockSpeech();
                    setMode("interactive");
                  }}
                />
              )}
              {mode === "sentence" && (
                <SentenceMode
                  onSubmit={(text, viaVoice) => {
                    setOpen(false);
                    startNavigationProgress();
                    router.push(`/w/${workspaceId}/entry?mode=${viaVoice ? "voice" : "text"}&q=${encodeURIComponent(text)}`);
                  }}
                />
              )}
              {mode === "interactive" && <InteractiveMode workspaceId={workspaceId} canPostPermission={canPost} voice={voice} onClose={() => setOpen(false)} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setMode((m) => (open ? m : "choose"));
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-expanded={open}
        aria-label={open ? "Close AI & Voice Entry" : "Open AI & Voice Entry"}
        title="AI & Voice Entry"
        className="group fixed bottom-5 right-4 z-50 flex h-14 items-center gap-2 rounded-full bg-brand pl-4 pr-5 text-white shadow-brand ring-4 ring-white/40 transition-[box-shadow] hover:shadow-[0_14px_34px_-10px_color-mix(in_srgb,var(--brand-from)_80%,transparent)] dark:ring-white/10 sm:bottom-6 sm:right-6 motion-safe:animate-[vl-soft-pulse_2.6s_ease-in-out_3]"
      >
        <span className="relative flex h-7 w-7 items-center justify-center">
          <AnimatePresence initial={false} mode="wait">
            {open ? (
              <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
                <X className="h-6 w-6" />
              </motion.span>
            ) : (
              <motion.span key="s" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
                <Sparkles className="h-6 w-6" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="hidden text-sm font-semibold sm:inline">{open ? "Close" : "AI Entry"}</span>
      </motion.button>
    </div>
  );
}

// ───────────────────────── Header & settings ─────────────────────────

function AssistantAvatar({ speaking = false, size = "md" }: { speaking?: boolean; size?: "sm" | "md" }) {
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-brand", size === "md" ? "h-10 w-10" : "h-7 w-7")}>
      <Sparkles className={size === "md" ? "h-5 w-5" : "h-3.5 w-3.5"} />
      {speaking && <span className="absolute inset-0 animate-ping rounded-full bg-[var(--brand-to)]/40" aria-hidden />}
    </span>
  );
}

function PanelHeader({
  mode,
  voice,
  showSettings,
  onToggleSettings,
  onBack,
  onClose,
}: {
  mode: Mode;
  voice: ReturnType<typeof useAssistantVoice>;
  showSettings: boolean;
  onToggleSettings: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const subtitle = mode === "sentence" ? "Sentence mode" : mode === "interactive" ? "Interactive mode" : "How would you like to record it?";
  return (
    <div className="relative flex items-center gap-3 border-b border-border/70 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--brand-from)_14%,transparent),color-mix(in_srgb,var(--brand-to)_8%,transparent))] px-4 py-3.5">
      {onBack ? (
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card/70 hover:text-foreground" aria-label="Back to modes">
          <ArrowLeft className="h-4 w-4" />
        </button>
      ) : null}
      <AssistantAvatar speaking={voice.speaking} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold">VLedger Assistant</p>
        <p className="truncate text-xs text-muted-foreground">{voice.speaking ? "Speaking…" : subtitle}</p>
      </div>
      {voice.supported && (
        <button
          onClick={() => voice.setMuted(!voice.muted)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card/70 hover:text-foreground"
          aria-label={voice.muted ? "Turn voice on" : "Mute voice"}
          title={voice.muted ? "Voice off" : "Voice on"}
        >
          {voice.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}
      {voice.supported && (
        <button
          onClick={onToggleSettings}
          className={cn("flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card/70 hover:text-foreground", showSettings && "bg-card/70 text-foreground")}
          aria-label="Voice settings"
          aria-pressed={showSettings}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      )}
      <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card/70 hover:text-foreground" aria-label="Close assistant">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function VoiceSettings({ voice, onDone }: { voice: ReturnType<typeof useAssistantVoice>; onDone: () => void }) {
  const [listenLang, setListenLang] = React.useState("en-IN");
  React.useEffect(() => setListenLang(readListenLanguage()), []);
  return (
    <div className="space-y-3 border-b border-border/70 bg-muted/40 px-4 py-3 text-sm">
      <label className="block text-xs font-medium text-muted-foreground" htmlFor="assistant-listen-lang">
        Listening language (your accent)
      </label>
      <select
        id="assistant-listen-lang"
        value={listenLang}
        onChange={(e) => {
          setListenLang(e.target.value);
          writeListenLanguage(e.target.value);
        }}
        className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {LISTEN_LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      <label className="block text-xs font-medium text-muted-foreground" htmlFor="assistant-voice">
        Assistant voice
      </label>
      <select
        id="assistant-voice"
        value={voice.voice?.name ?? ""}
        onChange={(e) => voice.chooseVoice(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {voice.options.length === 0 && <option value="">Default voice</option>}
        {voice.options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.female ? "♀ " : ""}
            {o.name} ({o.lang})
          </option>
        ))}
      </select>
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={() => voice.speak("Hi! I'm your VLedger assistant. I'll help you record transactions.")}>
          <Volume2 /> Hear sample
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      {voice.audioIssue && <p className="rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs text-warning">The last line didn&apos;t play. Try another voice, check the volume, or make sure this browser tab isn&apos;t muted.</p>}
      <p className="text-xs text-muted-foreground">Female voices are listed first. Voices come from your device and browser — Microsoft Edge offers the most natural ones (e.g. “Neerja Online (Natural)”).</p>
    </div>
  );
}

// ───────────────────────── Mode chooser ─────────────────────────

function ModeChooser({ onSentence, onInteractive }: { onSentence: () => void; onInteractive: () => void }) {
  const card =
    "group flex w-full items-start gap-3.5 rounded-2xl border border-border/80 bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="space-y-3 overflow-y-auto p-4">
      <p className="px-1 text-sm text-muted-foreground">Record an income, expense or transfer by voice or text. You always review before anything is saved.</p>
      <button className={card} onClick={onSentence}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary ring-1 ring-inset ring-primary/15">
          <MessageSquareText className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between font-semibold">
            Sentence Mode <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">Say or type everything in one sentence — “Spent ₹2,500 on electricity via HDFC Bank”.</span>
        </span>
      </button>
      <button className={card} onClick={onInteractive}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-brand">
          <AudioLines className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between font-semibold">
            Interactive Mode <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">I&apos;ll ask you step by step — income or expense, how much, when, what for and more.</span>
        </span>
      </button>
    </div>
  );
}

// ───────────────────────── Sentence mode (existing flow) ─────────────────────────

const EXAMPLES = [
  "Today I spent ₹2,500 for office electricity through HDFC Bank",
  "Received ₹75,000 from ABC Technologies for website development",
  "Paid 1,500 for petrol yesterday in cash",
];

function SentenceMode({ onSubmit }: { onSubmit: (text: string, viaVoice: boolean) => void }) {
  const [text, setText] = React.useState("");
  const [viaVoice, setViaVoice] = React.useState(false);
  const speech = useSpeechRecognition();

  React.useEffect(() => {
    if (speech.transcript) {
      setText(speech.transcript);
      setViaVoice(true);
    }
  }, [speech.transcript]);

  const shown = speech.listening ? `${text} ${speech.interim}`.trim() : text;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <p className="text-sm text-muted-foreground">Describe the transaction in one go. I&apos;ll pick out the type, amount, date, category and account for you to review.</p>
      <div className="relative">
        <textarea
          value={shown}
          onChange={(e) => {
            setText(e.target.value);
            setViaVoice(false);
          }}
          rows={4}
          maxLength={1000}
          placeholder="e.g. Received ₹75,000 from ABC Technologies for website development into HDFC Bank"
          className="w-full resize-none rounded-2xl border border-input bg-card px-3.5 py-3 pr-14 text-sm shadow-xs placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/12"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) onSubmit(text.trim(), viaVoice);
          }}
          aria-label="Describe the transaction"
        />
        <MicButton
          className="absolute bottom-3 right-3"
          listening={speech.listening}
          disabled={!speech.supported}
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
        />
      </div>
      {speech.error && <p className="text-xs text-expense">{speech.error}</p>}
      {!speech.supported && <p className="text-xs text-muted-foreground">Voice input isn&apos;t available in this browser — type instead, or use Chrome / Edge.</p>}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Try an example</p>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setText(ex);
              setViaVoice(false);
            }}
            className="block w-full truncate rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-left text-xs text-foreground/80 transition-colors hover:border-primary/30 hover:bg-accent/50"
          >
            “{ex}”
          </button>
        ))}
      </div>
      <Button className="mt-auto w-full" size="lg" disabled={!text.trim()} onClick={() => onSubmit(text.trim(), viaVoice)}>
        Analyze & review <ArrowRight />
      </Button>
    </div>
  );
}

function MicButton({ listening, disabled, onClick, className, size = "md" }: { listening: boolean; disabled?: boolean; onClick: () => void; className?: string; size?: "md" | "lg" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={listening ? "Stop listening" : "Speak your answer"}
      title={disabled ? "Voice input isn't supported in this browser" : listening ? "Listening… tap to stop" : "Tap to speak"}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-40",
        size === "lg" ? "h-12 w-12" : "h-10 w-10",
        listening ? "bg-expense text-white shadow-[0_8px_20px_-6px_rgba(220,38,38,0.6)]" : "bg-brand text-white shadow-brand hover:brightness-110",
        className,
      )}
    >
      {listening && <span className="absolute inset-0 animate-ping rounded-full bg-expense/40" aria-hidden />}
      {listening ? <MicOff className="relative h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
    </button>
  );
}

function Wave() {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="w-1 rounded-full bg-current" style={{ height: "100%", animation: `vl-wave 0.9s ease-in-out ${i * 0.12}s infinite` }} />
      ))}
    </span>
  );
}

// ───────────────────────── Interactive mode ─────────────────────────

function InteractiveMode({
  workspaceId,
  canPostPermission,
  voice,
  onClose,
}: {
  workspaceId: string;
  canPostPermission: boolean;
  voice: ReturnType<typeof useAssistantVoice>;
  onClose: () => void;
}) {
  const router = useRouter();
  const listener = useAnswerListener();
  const [ctx, setCtx] = React.useState<AssistantContext | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [draft, setDraft] = React.useState<Draft>({});
  const [step, setStep] = React.useState<StepId>("type");
  const [chips, setChips] = React.useState<Chip[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [saved, setSaved] = React.useState<Saved | null>(null);
  const [dupWarning, setDupWarning] = React.useState<{ intent: Intent; text: string } | null>(null);
  const [autoListen, setAutoListen] = React.useState(true);
  const transcript = React.useRef<string[]>([]);
  const usedVoice = React.useRef(false);
  const turn = React.useRef(0);
  const scroller = React.useRef<HTMLDivElement>(null);
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  React.useEffect(() => {
    try {
      setAutoListen(localStorage.getItem("vl.assistant.autolisten") !== "0");
    } catch {}
  }, []);

  React.useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, chips, step, saved, dupWarning]);

  const push = React.useCallback((m: Omit<Message, "id">) => setMessages((list) => [...list, { ...m, id: ++messageId }]), []);

  // The opening question is asked from the mount effect, before `supported` and
  // the saved auto-listen preference have loaded, so read them live from a ref.
  const live = React.useRef({ listener, voice, autoListen });
  live.current = { listener, voice, autoListen };

  /** Speaks a line, then (optionally) listens for the spoken answer. */
  const sayAndListen = React.useCallback(
    async (text: string, listenAfter: boolean, onHeard?: (answer: HeardAnswer) => void) => {
      const my = ++turn.current;
      live.current.listener.cancel();
      await live.current.voice.speak(text);
      const now = live.current;
      if (my !== turn.current || !listenAfter || !now.autoListen || !now.listener.supported) return;
      const heard = await now.listener.listen();
      if (my !== turn.current || !heard) return;
      onHeard?.(heard);
    },
    [],
  );

  const handleAnswerRef = React.useRef<(answer: string, viaVoice: boolean, alternatives?: string[]) => void>(() => {});

  const ask = React.useCallback(
    (d: Draft, c: AssistantContext, prefix?: string) => {
      const s = nextStep(d);
      setStep(s);
      setEditing(false);
      if (s === "confirm") {
        const q = question("confirm", d, c);
        setChips([]);
        push({ role: "assistant", text: prefix ? `${prefix} Here's what I have.` : "Here's what I have." });
        void sayAndListen(`${prefix ? `${prefix} ` : ""}${q.text}`, true, (a) => handleAnswerRef.current(a.text, true, a.alternatives));
        return;
      }
      const q = question(s, d, c);
      setChips(q.chips);
      const line = prefix ? `${prefix} ${q.text}` : q.text;
      push({ role: "assistant", text: line });
      void sayAndListen(line, true, (a) => handleAnswerRef.current(a.text, true, a.alternatives));
    },
    [push, sayAndListen],
  );

  // Load workspace context and greet. Only the latest start() may greet, so a
  // double mount or a quick "start over" never produces two conversations.
  const startToken = React.useRef(0);
  const start = React.useCallback(async () => {
    const token = ++startToken.current;
    turn.current++;
    listener.cancel();
    setMessages([]);
    setDraft({});
    setSaved(null);
    setDupWarning(null);
    setInput("");
    transcript.current = [];
    usedVoice.current = false;
    try {
      const c = ctx ?? (await apiFetch<AssistantContext>(`/api/w/${workspaceId}/ai/context`));
      if (token !== startToken.current) return;
      setCtx(c);
      ask({}, c, "Hi!");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load your accounts");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, ctx, ask]);

  React.useEffect(() => {
    void start();
    return () => {
      startToken.current++;
      turn.current++;
      listener.cancel();
      voice.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = React.useCallback(
    async (intent: Intent, skipDuplicateCheck = false) => {
      if (!ctx) return;
      const d = draftRef.current;
      turn.current++;
      listener.cancel();
      voice.stop();
      setBusy(true);
      try {
        const input = toTransactionInput(d, ctx);
        if (!skipDuplicateCheck) {
          const { duplicates } = await apiFetch<{ duplicates: { ref: string; date: string; amount: string; description: string | null }[] }>(
            `/api/w/${workspaceId}/transactions/check-duplicates`,
            { body: { type: input.type, amount: input.amount, date: input.date, description: input.description } },
          );
          if (duplicates.length) {
            const dup = duplicates[0];
            const text = `This looks similar to ${dup.ref} on ${formatDate(dup.date)} for ${formatMoney(dup.amount, ctx.currency)}${dup.description ? ` (${dup.description})` : ""}. Do you still want to save it?`;
            setDupWarning({ intent, text });
            push({ role: "assistant", text });
            void voice.speak(text);
            return;
          }
        }
        const res = await apiFetch<{ transaction: Saved & { status: string } }>(`/api/w/${workspaceId}/transactions`, {
          body: { input, intent, source: usedVoice.current ? "VOICE" : "TEXT", rawInput: transcript.current.join(" | ").slice(0, 1000) || null },
        });
        const t = res.transaction;
        setSaved({ id: t.id, ref: t.ref, status: t.status });
        setDupWarning(null);
        const line = `Done! ${t.ref} is ${STATUS_TEXT[t.status] ?? "saved"}.`;
        push({ role: "assistant", text: line, tone: "success" });
        toast.success(`${t.ref} ${STATUS_TEXT[t.status] ?? "saved"}`);
        void voice.speak(line.replace(/TXN-0*(\d+)/, "transaction $1"));
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        const approval = e instanceof ClientApiError && e.code === "APPROVAL_REQUIRED";
        const line = approval ? "This one needs approval before it can be posted. You can submit it for approval instead." : `Sorry, I couldn't save it. ${msg}`;
        push({ role: "assistant", text: line, tone: "error" });
        void voice.speak(line);
      } finally {
        setBusy(false);
      }
    },
    [ctx, workspaceId, push, voice, listener, router],
  );

  const blocked = ctx ? needsApproval(draft, ctx) : false;
  const canPost = canPostPermission && Boolean(ctx?.canPost) && !blocked;
  const primaryIntent: Intent = canPost ? "post" : "submit";

  const handleAnswer = React.useCallback(
    (raw: string, viaVoice: boolean, alternatives: string[] = []) => {
      let answer = raw.trim();
      if (!answer || !ctx || busy || saved) return;
      // Speech recognition offers several guesses; use the first one that answers this question.
      if (alternatives.length > 1 && step !== "confirm" && !dupWarning) {
        const fits = alternatives.find((alt) => interpret(step, alt, draftRef.current, ctx).ok);
        if (fits) answer = fits.trim();
      }
      turn.current++;
      listener.cancel();
      voice.stop();
      if (viaVoice) usedVoice.current = true;
      push({ role: "user", text: answer });
      transcript.current.push(answer);
      setInput("");

      if (dupWarning) {
        const yes = parseYesNo(answer);
        if (yes) void save(dupWarning.intent, true);
        else {
          setDupWarning(null);
          push({ role: "assistant", text: "Okay, I won't save it. You can change something or start over." });
        }
        return;
      }

      if (step === "confirm") {
        const lower = answer.toLowerCase();
        const field = EDITABLE_FIELDS.find((f) => lower.includes(f.label.toLowerCase().split(" ")[0]));
        if (/draft/.test(lower)) return void save("draft");
        if (/submit|approval/.test(lower)) return void save("submit");
        if (/change|edit|wrong|fix/.test(lower) && field) {
          const d = clearField(draftRef.current, field.step);
          setDraft(d);
          return ask(d, ctx, "Sure.");
        }
        const yes = parseYesNo(answer);
        if (yes === true) return void save(primaryIntent);
        if (yes === false || /change|edit/.test(lower)) {
          setEditing(true);
          const line = "No problem. What would you like to change?";
          push({ role: "assistant", text: line });
          void voice.speak(line);
          return;
        }
        const line = "Should I save it? Say yes to save, or tell me what to change.";
        push({ role: "assistant", text: line });
        void sayAndListen(line, true, (a) => handleAnswerRef.current(a.text, true, a.alternatives));
        return;
      }

      const result = interpret(step, answer, draftRef.current, ctx);
      if (!result.ok) {
        push({ role: "assistant", text: result.retry, tone: "error" });
        void sayAndListen(result.retry, true, (a) => handleAnswerRef.current(a.text, true, a.alternatives));
        return;
      }
      const d = { ...draftRef.current, ...result.patch };
      setDraft(d);
      ask(d, ctx, result.ack);
    },
    [ctx, busy, saved, step, dupWarning, push, voice, listener, save, ask, primaryIntent, sayAndListen],
  );
  handleAnswerRef.current = handleAnswer;

  const startListening = async () => {
    if (listener.listening) return listener.cancel();
    turn.current++;
    voice.stop();
    const heard = await listener.listen();
    if (heard) handleAnswer(heard.text, true, heard.alternatives);
  };

  const editField = (s: StepId) => {
    if (!ctx) return;
    const d = clearField(draftRef.current, s);
    setDraft(d);
    ask(d, ctx, "Sure.");
  };

  if (loadError) {
    return (
      <div className="p-5 text-sm">
        <p className="font-medium text-expense">I couldn&apos;t load your accounts.</p>
        <p className="mt-1 text-muted-foreground">{loadError}</p>
        <Button className="mt-4" size="sm" onClick={() => { setLoadError(null); void start(); }}>
          Try again
        </Button>
      </div>
    );
  }

  const prog = progress(draft);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <>
      {/* progress */}
      {!saved && (
        <div className="flex items-center gap-3 px-4 pt-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full rounded-full bg-brand" animate={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} transition={{ duration: 0.3 }} />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground tabular">
            {Math.min(prog.done + (step === "confirm" ? 0 : 1), prog.total)}/{prog.total}
          </span>
        </div>
      )}

      {/* conversation */}
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {!ctx && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Getting your accounts ready…
          </div>
        )}
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className={cn("flex items-end gap-2", m.role === "user" && "justify-end")}
          >
            {m.role === "assistant" && <AssistantAvatar size="sm" speaking={voice.speaking && m === lastAssistant} />}
            <div
              className={cn(
                "max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "rounded-br-md bg-brand text-white shadow-brand"
                  : m.tone === "error"
                    ? "rounded-bl-md border border-warning/30 bg-warning-soft text-foreground"
                    : m.tone === "success"
                      ? "rounded-bl-md border border-income/30 bg-income-soft text-foreground"
                      : "rounded-bl-md border border-border/70 bg-muted/60",
              )}
            >
              {m.text}
            </div>
          </motion.div>
        ))}

        {/* summary card */}
        {ctx && step === "confirm" && !saved && (
          <div className="rounded-2xl border border-border/80 bg-card p-3 shadow-card">
            <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">{summary(draft, ctx)}</p>
            <dl className="divide-y divide-border/60 text-sm">
              {summaryRows(draft, ctx).map((r) => (
                <div key={r.label} className="flex items-center gap-2 px-1 py-1.5">
                  <dt className="w-24 shrink-0 text-xs text-muted-foreground">{r.label}</dt>
                  <dd className="min-w-0 flex-1 truncate font-medium">{r.value}</dd>
                  <button onClick={() => editField(r.step)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Change ${r.label}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </dl>
            {blocked && <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs text-warning">This amount needs approval, so it will be submitted for approval.</p>}
            {dupWarning ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="sm" loading={busy} onClick={() => void save(dupWarning.intent, true)}>
                  Save anyway
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDupWarning(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="sm" className="col-span-2" loading={busy} onClick={() => void save(primaryIntent)}>
                  <Check /> {primaryIntent === "post" ? "Save & post" : "Submit for approval"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void save("draft")}>
                  Save draft
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing((e) => !e)}>
                  <Pencil /> Change
                </Button>
              </div>
            )}
            {editing && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {summaryRows(draft, ctx).map((r) => (
                  <button key={r.label} onClick={() => editField(r.step)} className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs hover:border-primary/40 hover:bg-accent">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* done */}
        {saved && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/w/${workspaceId}/transactions/${saved.id}`} onClick={onClose}>
                View {saved.ref}
              </Link>
            </Button>
            <Button size="sm" onClick={() => void start()}>
              <RotateCcw /> Record another
            </Button>
          </div>
        )}
      </div>

      {/* quick replies */}
      {!saved && step !== "confirm" && chips.length > 0 && (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto border-t border-border/60 px-4 py-2.5">
          {chips.map((c) => (
            <button
              key={`${c.label}-${c.value}`}
              onClick={() => handleAnswer(c.value, false)}
              disabled={busy}
              className="rounded-full border border-primary/25 bg-accent/60 px-3 py-1 text-xs font-medium text-accent-foreground transition-colors hover:border-primary/50 hover:bg-accent"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* composer */}
      {!saved && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAnswer(input, false);
          }}
          className="flex items-center gap-2 border-t border-border/70 bg-muted/30 px-3 py-3"
        >
          <MicButton listening={listener.listening} disabled={!listener.supported || !ctx} onClick={() => void startListening()} />
          <div className="relative min-w-0 flex-1">
            <input
              value={listener.listening ? listener.interim : input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listener.listening ? (listener.ready ? "Listening… speak now" : "Starting microphone…") : voice.speaking ? "Speaking…" : "Type your answer…"}
              disabled={!ctx || busy}
              className="h-10 w-full rounded-full border border-input bg-card pl-4 pr-10 text-sm placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/12"
              aria-label="Your answer"
            />
            {(listener.listening || voice.speaking) && (
              <span className={cn("absolute right-3 top-1/2 -translate-y-1/2", listener.listening ? "text-expense" : "text-primary")}>
                <Wave />
              </span>
            )}
          </div>
          <Button type="submit" size="icon" className="rounded-full" disabled={!input.trim() || !ctx || busy} aria-label="Send answer">
            <Send />
          </Button>
        </form>
      )}
      {!saved && (
        <div className="flex items-center justify-between gap-2 px-4 pb-2.5 text-[11px] text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoListen}
              onChange={(e) => {
                setAutoListen(e.target.checked);
                try {
                  localStorage.setItem("vl.assistant.autolisten", e.target.checked ? "1" : "0");
                } catch {}
              }}
              className="h-3.5 w-3.5 accent-[var(--brand-from)]"
              disabled={!listener.supported}
            />
            Listen after each question
          </label>
          <button onClick={() => void start()} className="inline-flex items-center gap-1 hover:text-foreground">
            <RotateCcw className="h-3 w-3" /> Start over
          </button>
        </div>
      )}
      {listener.error && <p className="px-4 pb-2 text-xs text-expense">{listener.error}</p>}
    </>
  );
}
