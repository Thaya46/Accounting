"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  PenLine,
  RotateCcw,
  Sparkles,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type DuplicateWarning, type FormOptions, type SavedTransaction } from "@/lib/transactions/types";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { Label, Switch } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { useSpeechRecognition } from "./use-speech";
import { AiReview, type ParseResult } from "./ai-review";
import { approvalRequired, exampleSentences } from "./form-utils";
import { AmountText } from "./display";

const LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "hi-IN", label: "Hindi (हिन्दी)" },
  { value: "ta-IN", label: "Tamil (தமிழ்)" },
];

type Mode = "text" | "voice";
type Analysis = ParseResult & { raw: string; source: "TEXT" | "VOICE"; key: number };
type Saved = SavedTransaction & { autoPosted: boolean };

const AUTO_POST_KEY = "vledger:auto-post-ai";

function readPref(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Preferences are a convenience only.
  }
}

/** Safe for unattended posting: complete, confident, no duplicates, no approval needed. */
function autoPostEligible(r: ParseResult, options: FormOptions) {
  const p = r.parsed;
  if (!options.settings.autoPostEnabled || !options.permissions.canPost) return false;
  if (!p.type || !p.amount || p.missing.length || p.clarifications.length) return false;
  if (p.confidence < options.settings.autoPostMinConfidence) return false;
  if (r.duplicates.length) return false;
  if (p.currency !== options.currency) return false;
  if (!p.paymentAccountId) return false;
  if (p.type === "TRANSFER" ? !p.toAccountId : !p.categoryId) return false;
  return !approvalRequired(options.settings, p.amount);
}

function inputFromParsed(p: ParseResult["parsed"]) {
  const common = { type: p.type, date: p.date, amount: p.amount, currency: p.currency, description: p.description, paymentMethod: p.paymentMethod };
  if (p.type === "EXPENSE") return { ...common, categoryId: p.categoryId, creditAccountId: p.paymentAccountId, vendorName: p.counterparty };
  if (p.type === "INCOME") return { ...common, categoryId: p.categoryId, debitAccountId: p.paymentAccountId, customerName: p.counterparty };
  return { ...common, debitAccountId: p.toAccountId, creditAccountId: p.paymentAccountId };
}

/**
 * AI & Voice Entry: capture a sentence by typing or speaking, extract the
 * fields on the server, then review and save. Attribution always comes from
 * the signed-in session.
 */
export function AiEntry({
  options,
  initialMode,
  initialQuery,
  providerLabel,
}: {
  options: FormOptions;
  initialMode: Mode;
  initialQuery: string | null;
  providerLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = React.useState<Mode>(initialMode);
  const [text, setText] = React.useState(initialMode === "text" ? (initialQuery ?? "") : "");
  const [voiceText, setVoiceText] = React.useState(initialMode === "voice" ? (initialQuery ?? "") : "");
  const [lang, setLang] = React.useState("en-IN");
  const speech = useSpeechRecognition(lang);
  const resetSpeech = speech.reset;
  const [mounted, setMounted] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [saved, setSaved] = React.useState<Saved | null>(null);
  const [autoPost, setAutoPost] = React.useState(false);
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const reviewRef = React.useRef<HTMLDivElement>(null);
  const canAutoPost = options.settings.autoPostEnabled && options.permissions.canPost;

  React.useEffect(() => {
    setMounted(true);
    if (canAutoPost) setAutoPost(readPref(AUTO_POST_KEY));
  }, [canAutoPost]);

  // Mirror the live transcript into the editable voice text.
  React.useEffect(() => {
    if (speech.listening || speech.transcript) setVoiceText(speech.transcript);
  }, [speech.transcript, speech.listening]);

  const examples = React.useMemo(() => exampleSentences(options, (n) => formatMoney(n, options.currency)), [options]);

  const finishSave = React.useCallback(
    (t: SavedTransaction, extra: { autoPosted: boolean; duplicates: DuplicateWarning[] }) => {
      const url = `/w/${options.workspaceId}/transactions/${t.id}`;
      const state = t.status === "POSTED" ? (extra.autoPosted ? "posted automatically" : "posted") : t.status === "PENDING_APPROVAL" ? "submitted for approval" : "saved as a draft";
      toast.success(`${t.ref} ${state}`, {
        description: `${t.description} · ${formatMoney(t.amount, t.currency, { decimals: true })}`,
        action: { label: "View", onClick: () => router.push(url) },
      });
      if (extra.duplicates.length) toast.warning(`${extra.duplicates.length} similar transaction${extra.duplicates.length === 1 ? "" : "s"} already exist${extra.duplicates.length === 1 ? "s" : ""}.`);
      setSaved({ ...t, autoPosted: extra.autoPosted });
      setAnalysis(null);
      setText("");
      setVoiceText("");
      resetSpeech();
      router.refresh();
    },
    [options.workspaceId, router, resetSpeech],
  );

  const analyze = React.useCallback(
    async (raw: string, source: "TEXT" | "VOICE") => {
      const sentence = raw.trim();
      if (!sentence) {
        toast.error(source === "VOICE" ? "Say what happened first." : "Type what happened first.");
        return;
      }
      setAnalyzing(true);
      setSaved(null);
      try {
        const r = await apiFetch<ParseResult>(`/api/w/${options.workspaceId}/ai/parse`, { body: { text: sentence.slice(0, 1000), source } });
        if (autoPost && autoPostEligible(r, options)) {
          try {
            const res = await apiFetch<{ transaction: SavedTransaction; duplicates: DuplicateWarning[]; autoPosted: boolean }>(`/api/w/${options.workspaceId}/transactions`, {
              body: { input: inputFromParsed(r.parsed), intent: "auto", source, rawInput: sentence, aiConfidence: r.parsed.confidence },
            });
            finishSave(res.transaction, { autoPosted: res.autoPosted, duplicates: res.duplicates });
            return;
          } catch (e) {
            toast.error(`Auto-post skipped: ${e instanceof Error ? e.message : "could not save"}. Review the entry below.`);
          }
        }
        setAnalysis({ ...r, raw: sentence, source, key: Date.now() });
        requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not analyse the entry");
      } finally {
        setAnalyzing(false);
      }
    },
    [autoPost, finishSave, options],
  );

  // Hand-off from the dashboard Quick Entry widget (?q=…): analyse once, then drop q from the URL.
  const handled = React.useRef(false);
  React.useEffect(() => {
    if (handled.current || !initialQuery?.trim()) return;
    handled.current = true;
    void analyze(initialQuery, initialMode === "voice" ? "VOICE" : "TEXT");
    try {
      window.history.replaceState(null, "", `${pathname}?mode=${initialMode}`);
    } catch {
      // Non-critical.
    }
  }, [analyze, initialMode, initialQuery, pathname]);

  // When a recording ends with a transcript, analyse it straight away.
  const wasListening = React.useRef(false);
  React.useEffect(() => {
    if (wasListening.current && !speech.listening && speech.transcript.trim() && !speech.error) {
      void analyze(speech.transcript, "VOICE");
    }
    wasListening.current = speech.listening;
  }, [speech.listening, speech.transcript, speech.error, analyze]);

  function applyExample(kind: "EXPENSE" | "INCOME" | "TRANSFER") {
    setTab("text");
    setText(examples[kind]);
    requestAnimationFrame(() => {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(examples[kind].length, examples[kind].length);
    });
  }

  function toggleMic() {
    if (speech.listening) speech.stop();
    else {
      setVoiceText("");
      setAnalysis(null);
      speech.start();
    }
  }

  const voiceUnsupported = mounted && !speech.supported;
  const liveText = speech.listening ? `${voiceText} ${speech.interim}`.trim() : voiceText;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Capture */}
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Describe the transaction</CardTitle>
            <CardDescription>Say it the way you would tell your accountant. You review everything before it is saved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2" aria-label="Examples">
              <Button type="button" variant="outline" size="sm" onClick={() => applyExample("EXPENSE")} className="gap-1.5">
                <ArrowUpRight className="text-expense" /> AI Expense Entry
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyExample("INCOME")} className="gap-1.5">
                <ArrowDownLeft className="text-income" /> AI Income Entry
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyExample("TRANSFER")} className="gap-1.5">
                <ArrowLeftRight className="text-info" /> Transfer
              </Button>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as Mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="text">
                  <Keyboard /> Type it
                </TabsTrigger>
                <TabsTrigger value="voice">
                  <Mic /> Speak it
                </TabsTrigger>
              </TabsList>

              <TabsContent value="text" className="space-y-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void analyze(text, "TEXT");
                  }}
                  className="space-y-3"
                >
                  <Textarea
                    ref={textRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void analyze(text, "TEXT");
                      }
                    }}
                    maxLength={1000}
                    rows={4}
                    placeholder={`e.g. ${examples.EXPENSE}`}
                    aria-label="Describe the transaction"
                    className="resize-y text-[15px]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      <span className="hidden sm:inline">Ctrl + Enter to analyse · </span>
                      {text.length}/1000
                    </span>
                    <Button type="submit" loading={analyzing} disabled={!text.trim()}>
                      {!analyzing && <Sparkles />} Analyze
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="voice" className="space-y-4">
                {voiceUnsupported ? (
                  <Alert variant="warning" title="Voice input isn't available in this browser">
                    <p>Use Chrome, Edge or Safari for voice entry — or type it instead.</p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab("text")}>
                      <Keyboard /> Switch to typing
                    </Button>
                  </Alert>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="voice-lang" className="text-xs text-muted-foreground">
                        Language
                      </Label>
                      <NativeSelect id="voice-lang" value={lang} onChange={(e) => setLang(e.target.value)} disabled={speech.listening} className="h-8 w-auto text-xs">
                        {LANGUAGES.map((l) => (
                          <option key={l.value} value={l.value}>
                            {l.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-col items-center gap-3 py-2">
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.95 }}
                        onClick={toggleMic}
                        disabled={!mounted || analyzing}
                        aria-pressed={speech.listening}
                        aria-label={speech.listening ? "Stop recording" : "Start recording"}
                        className={cn(
                          "relative flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-2 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
                          speech.listening ? "border-expense bg-expense text-white" : "border-primary/30 bg-accent text-primary hover:bg-primary hover:text-primary-foreground",
                        )}
                      >
                        {speech.listening && (
                          <>
                            <span className="absolute inset-0 animate-ping rounded-full bg-expense/30" aria-hidden />
                            <span className="absolute -inset-2 animate-pulse rounded-full border-2 border-expense/30" aria-hidden />
                          </>
                        )}
                        {speech.listening ? <MicOff className="relative h-8 w-8" /> : <Mic className="h-8 w-8" />}
                      </motion.button>
                      <p className={cn("text-sm font-medium", speech.listening ? "text-expense" : "text-muted-foreground")} aria-live="polite">
                        {speech.listening ? "Listening… tap to stop" : analyzing ? "Analysing…" : "Tap the mic and speak"}
                      </p>
                    </div>
                    {speech.error && <Alert variant="danger">{speech.error}</Alert>}
                    <div className="space-y-2">
                      <Label htmlFor="voice-text" className="text-xs text-muted-foreground">
                        Transcript {speech.listening ? "(live)" : "(you can edit it)"}
                      </Label>
                      {speech.listening ? (
                        <div id="voice-text" className="min-h-[88px] rounded-md border bg-muted/40 px-3 py-2 text-[15px]" aria-live="polite">
                          {voiceText && <span>{voiceText} </span>}
                          {speech.interim && <span className="italic text-muted-foreground">{speech.interim}</span>}
                          {!liveText && <span className="text-muted-foreground">Start speaking…</span>}
                        </div>
                      ) : (
                        <Textarea
                          id="voice-text"
                          value={voiceText}
                          onChange={(e) => {
                            setVoiceText(e.target.value);
                            speech.setTranscript(e.target.value);
                          }}
                          maxLength={1000}
                          rows={3}
                          placeholder={`e.g. "${examples.EXPENSE}"`}
                          className="text-[15px]"
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          speech.reset();
                          setVoiceText("");
                        }}
                        disabled={speech.listening || !voiceText}
                      >
                        <RotateCcw /> Clear
                      </Button>
                      <Button onClick={() => analyze(voiceText, "VOICE")} loading={analyzing} disabled={speech.listening || !voiceText.trim()}>
                        {!analyzing && <Sparkles />} Analyze
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Audio is converted to text by your browser&apos;s speech service. VLedger only receives the text.</p>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Extraction engine: <span className="font-medium text-foreground">{providerLabel}</span>
          </span>
          {canAutoPost && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <Switch
                checked={autoPost}
                onCheckedChange={(v) => {
                  setAutoPost(v);
                  writePref(AUTO_POST_KEY, v);
                }}
                aria-label="Auto-post high-confidence entries"
              />
              <span>
                <Zap className="mr-0.5 inline h-3.5 w-3.5 text-warning" />
                Auto-post when ≥ {Math.round(options.settings.autoPostMinConfidence * 100)}% confident
              </span>
            </label>
          )}
        </div>
      </div>

      {/* Review */}
      <div ref={reviewRef} className="scroll-mt-20 lg:col-span-3">
        <AnimatePresence mode="wait">
          {analyzing ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card>
                <CardContent className="space-y-4 p-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" /> Reading your entry and matching your accounts…
                  </div>
                  <Skeleton className="h-9 w-64" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-14" />
                    ))}
                  </div>
                  <Skeleton className="h-10" />
                </CardContent>
              </Card>
            </motion.div>
          ) : analysis ? (
            <motion.div key={analysis.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AiReview
                options={options}
                result={analysis}
                rawInput={analysis.raw}
                source={analysis.source}
                onSaved={finishSave}
                onDiscard={() => setAnalysis(null)}
              />
            </motion.div>
          ) : saved ? (
            <motion.div key={`saved-${saved.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Card className="overflow-hidden">
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-income-soft">
                    <CheckCircle2 className="h-6 w-6 text-income" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">
                      {saved.ref} {saved.autoPosted ? "posted automatically" : `saved — ${STATUS_LABELS[saved.status].toLowerCase()}`}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{saved.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <AmountText amount={saved.amount} currency={saved.currency} type={saved.type} className="text-xl" />
                    <StatusBadge status={saved.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">Entered by {saved.createdByName}</p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    <Button asChild variant="outline">
                      <Link href={`/w/${options.workspaceId}/transactions/${saved.id}`}>
                        <ClipboardCheck /> View transaction
                      </Link>
                    </Button>
                    <Button
                      onClick={() => {
                        setSaved(null);
                        if (tab === "text") requestAnimationFrame(() => textRef.current?.focus());
                      }}
                    >
                      <PenLine /> Record another
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card>
                <CardHeader>
                  <CardTitle>How it works</CardTitle>
                  <CardDescription>Three quick steps — and the AI never guesses missing details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <ol className="grid gap-3 sm:grid-cols-3">
                    {[
                      { icon: Mic, title: "Describe", body: "Type or speak a sentence with the amount, what it was for and how it was paid." },
                      { icon: Sparkles, title: "Review", body: "Check the extracted type, category, accounts and date. Answer any questions." },
                      { icon: CheckCircle2, title: "Save", body: "Save a draft, submit for approval, or post a balanced journal entry." },
                    ].map((s, i) => (
                      <li key={s.title} className="rounded-lg border bg-muted/30 p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
                          <s.icon className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">{s.title}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{s.body}</p>
                      </li>
                    ))}
                  </ol>
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Try an example</p>
                    {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => applyExample(k)}
                        className="flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <Badge variant={k === "EXPENSE" ? "danger" : k === "INCOME" ? "success" : "info"} className="mt-0.5 shrink-0">
                          {k === "EXPENSE" ? "Expense" : k === "INCOME" ? "Income" : "Transfer"}
                        </Badge>
                        <span className="text-foreground/90">“{examples[k]}”</span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
