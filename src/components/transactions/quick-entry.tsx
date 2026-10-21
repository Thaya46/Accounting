"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Loader2, Mic, MicOff, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSpeechRecognition } from "./use-speech";
import { apiFetch } from "@/lib/client/api";

type AutoEnterResponse = {
  ok: boolean;
  posted: boolean;
  transaction?: { id: string; number: number };
  voucherType?: string;
  message?: string;
  clarification?: string;
  error?: string;
  parsed?: {
    type: string | null;
    amount: string | null;
    description: string;
    categoryName: string | null;
    paymentAccountName: string | null;
  };
};

/**
 * Intelligent voice/text capture for dashboards.
 * For common people who don't know accounting: speak or type naturally
 * (e.g. "Today I spent ₹2,500 for office electricity through Primary Bank Account")
 * and it automatically parses, maps to Tally vouchers, and records it immediately.
 */
export function QuickEntry({
  workspaceId,
  mode,
  className,
}: {
  workspaceId: string;
  mode: "voice" | "text";
  className?: string;
}) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const speech = useSpeechRecognition();
  const isVoice = mode === "voice";

  React.useEffect(() => {
    if (isVoice && speech.transcript) setText(speech.transcript);
  }, [isVoice, speech.transcript]);

  const handleInstantSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || submitting) return;

    if (speech.listening) {
      speech.stop();
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<AutoEnterResponse>(`/api/w/${workspaceId}/ai/auto-enter`, {
        method: "POST",
        body: JSON.stringify({
          text: q,
          source: isVoice ? "VOICE" : "TEXT",
        }),
      });

      if (res.ok && res.posted) {
        toast.success(res.message || "Transaction automatically recorded!", {
          description: "Balanced double-entry journal & Tally voucher created.",
          duration: 5000,
        });
        setText("");
        router.refresh();
      } else if (res.ok && !res.posted && res.clarification) {
        toast.info(res.clarification, {
          description: "Opening review to complete missing details...",
        });
        router.push(`/w/${workspaceId}/entry?mode=${mode}&q=${encodeURIComponent(q)}`);
      } else {
        router.push(`/w/${workspaceId}/entry?mode=${mode}&q=${encodeURIComponent(q)}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not auto-record", {
        description: "Redirecting to manual review...",
      });
      router.push(`/w/${workspaceId}/entry?mode=${mode}&q=${encodeURIComponent(q)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className={cn("overflow-hidden border-primary/20 shadow-xs", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            {isVoice ? <Mic className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
            {isVoice ? "Instant Voice Entry" : "Instant Smart Entry"}
          </CardTitle>
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Zap className="h-3 w-3" /> Auto-Posts
          </span>
        </div>
        <CardDescription className="text-xs">
          {isVoice ? "Tap the mic and speak in plain words." : "Type naturally without knowing accounting debit/credits."}{" "}
          Automatically enters and balances!
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleInstantSubmit} className="flex items-center gap-2">
          {isVoice && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              disabled={!speech.supported || submitting}
              className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50",
                speech.listening ? "border-expense bg-expense text-white" : "bg-card hover:bg-muted",
              )}
              aria-label={speech.listening ? "Stop recording" : "Start recording"}
              title={speech.supported ? undefined : "Voice input is not supported in this browser"}
            >
              {speech.listening && <span className="absolute inset-0 animate-ping rounded-full bg-expense/40" />}
              {speech.listening ? <MicOff className="relative h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </motion.button>
          )}
          <input
            value={isVoice && speech.listening ? `${text} ${speech.interim}`.trim() : text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
            placeholder={
              isVoice
                ? "e.g. Today I spent ₹2,500 for office electricity through Primary Bank Account"
                : "e.g. Today I spent ₹2,500 for office electricity through Primary Bank Account"
            }
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
            aria-label={isVoice ? "Voice transcript" : "Describe the transaction"}
          />
          <Button
            type="submit"
            size="default"
            disabled={!text.trim() || submitting}
            className="gap-1.5 shrink-0"
            aria-label="Auto record entry"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Entering...</span>
              </>
            ) : (
              <>
                <span>Enter</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>
        {speech.error && isVoice && <p className="mt-2 text-xs text-expense">{speech.error}</p>}
      </CardContent>
    </Card>
  );
}
