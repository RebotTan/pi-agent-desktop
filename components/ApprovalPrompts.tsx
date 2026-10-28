"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface PendingApproval {
  id: string;
  toolName: string;
  args: unknown;
  requestedAt: number;
}

const POLL_INTERVAL_MS = 1500;

/**
 * Approval prompts for tool calls held by an `ask` policy rule.
 *
 * Polls `/api/tool-policy` instead of subscribing to the agent event bus: an
 * approval is a blocking, low-frequency event (one per held tool call), and
 * polling keeps this component free of the SSE lifecycle that a live session
 * already owns. Polling stops while the window is hidden — nobody can answer a
 * prompt they cannot see, and the next visible tick re-syncs.
 */
export function ApprovalPrompts() {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await fetch("/api/tool-policy", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { pending?: PendingApproval[] };
      setPending(Array.isArray(data.pending) ? data.pending : []);
    } catch {
      // A failed poll leaves the previous prompts on screen; the next tick retries.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const settle = useCallback(async (id: string, approved: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tool-policy/settle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, approved }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        // `ok: false` means another client settled it first — refetch instead of
        // showing a failure the user cannot act on.
        setError(response.ok && data.ok === false ? null : (data.error ?? t("approval.failed")));
      }
      await load();
    } catch {
      setError(t("approval.failed"));
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  const current = pending[0];
  if (!current) return null;
  const extra = pending.length - 1;
  const args = formatArgs(current.args);

  return (
    <div className="approval-prompts" style={{ padding: "0 16px" }}>
      <div className="approval-card" role="alertdialog" aria-label={t("approval.title")}>
        <div className="approval-card-head">
          <span className="approval-card-title">{t("approval.title")}</span>
          <code className="approval-card-tool">{current.toolName}</code>
          {extra > 0 && <span className="approval-card-more">{t("approval.more").replace("{count}", String(extra))}</span>}
        </div>
        {args && <pre className="approval-card-args">{args}</pre>}
        {error && <div className="approval-card-error" role="status">{error}</div>}
        <div className="approval-card-actions">
          <button type="button" className="approval-card-button" disabled={busy} onClick={() => void settle(current.id, false)}>
            {t("approval.deny")}
          </button>
          <button type="button" className="approval-card-button is-primary" disabled={busy} onClick={() => void settle(current.id, true)}>
            {busy ? t("approval.settling") : t("approval.allow")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Render the held tool arguments as readable text; long values wrap, never clip. */
function formatArgs(args: unknown): string {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
