"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

const START_EVENT = "vl:navigation-start";

/** Call before a programmatic navigation (router.push) so the progress bar shows immediately. */
export function startNavigationProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(START_EVENT));
}

function isInternalNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const anchor = (e.target as Element | null)?.closest?.("a");
  if (!anchor || !anchor.href || anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  return url.pathname !== window.location.pathname || url.search !== window.location.search;
}

function ProgressBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [phase, setPhase] = React.useState<"idle" | "loading" | "done">("idle");
  const phaseRef = React.useRef(phase);
  phaseRef.current = phase;

  // Start on any internal link click (capture phase, before Next handles it) or on request.
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (isInternalNavigation(e)) setPhase("loading");
    };
    const onStart = () => setPhase("loading");
    document.addEventListener("click", onClick, true);
    window.addEventListener(START_EVENT, onStart);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(START_EVENT, onStart);
    };
  }, []);

  // Finish when the URL actually changes.
  const key = `${pathname}?${search?.toString() ?? ""}`;
  React.useEffect(() => {
    if (phaseRef.current !== "loading") return;
    setPhase("done");
    const t = setTimeout(() => setPhase("idle"), 350);
    return () => clearTimeout(t);
  }, [key]);

  // Safety net: never leave the bar stuck (e.g. navigation cancelled).
  React.useEffect(() => {
    if (phase !== "loading") return;
    const t = setTimeout(() => setPhase("idle"), 30_000);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] print:hidden" role="progressbar" aria-label="Loading page" aria-busy={phase === "loading"}>
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--primary)]"
        style={
          phase === "loading"
            ? { width: "85%", transition: "width 8s cubic-bezier(0.08, 0.8, 0.2, 1)", animation: "vl-progress-in 0.15s ease-out" }
            : { width: "100%", opacity: 0, transition: "width 0.2s ease-out, opacity 0.3s ease 0.1s" }
        }
      />
      <style>{`@keyframes vl-progress-in { from { width: 0% } to { width: 12% } }`}</style>
    </div>
  );
}

/** Thin top progress bar shown from the moment a link is clicked until the new page renders. */
export function NavigationProgress() {
  return (
    <React.Suspense fallback={null}>
      <ProgressBar />
    </React.Suspense>
  );
}
