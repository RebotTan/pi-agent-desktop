"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "./AppSelect";
import { ConfigPanelShell } from "./SettingsUi";
import { useI18n } from "@/hooks/useI18n";

type Action = "allow" | "deny" | "ask";

interface Rule {
  id: string;
  pattern: string;
  action: Action;
  note?: string;
}

const ACTIONS: Action[] = ["allow", "ask", "deny"];

/**
 * Rule editor for tool approval policy (Settings › 工具审批).
 *
 * Reads and writes the documented `/api/tool-policy` contract only, so the
 * store can move to disk or to a sidecar host without touching this panel.
 * Rules are evaluated in order and the first match wins; no match allows the
 * call, which is what keeps the default experience unchanged.
 */
export function ToolPolicySettings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [rules, setRules] = useState<Rule[]>([]);
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<Action>("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tool-policy", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { rules?: Rule[] };
      setRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      setError(t("toolPolicy.failed"));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const addRule = useCallback(async () => {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tool-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pattern: trimmed, action }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("toolPolicy.failed"));
      } else {
        setPattern("");
        await load();
      }
    } catch {
      setError(t("toolPolicy.failed"));
    } finally {
      setBusy(false);
    }
  }, [action, load, pattern, t]);

  const removeRule = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tool-policy?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) setError(t("toolPolicy.failed"));
      await load();
    } catch {
      setError(t("toolPolicy.failed"));
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  const actionOptions = ACTIONS.map((value) => ({ value, label: t(`toolPolicy.${value}`) }));

  return (
    <ConfigPanelShell embedded title={t("toolPolicy.title")} subtitle={t("toolPolicy.subtitle")} onClose={onClose}>
      <div className="tool-policy-panel">
        <p className="tool-policy-hint">{t("toolPolicy.hint")}</p>

        <div className="tool-policy-add">
          <input
            className="tool-policy-input"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void addRule(); }}
            placeholder={t("toolPolicy.patternPlaceholder")}
            aria-label={t("toolPolicy.pattern")}
            spellCheck={false}
          />
          <AppSelect
            value={action}
            onValueChange={(next) => setAction(next as Action)}
            options={actionOptions}
            aria-label={t("toolPolicy.action")}
          />
          <button type="button" className="tool-policy-button is-primary" disabled={busy || !pattern.trim()} onClick={() => void addRule()}>
            {t("toolPolicy.add")}
          </button>
        </div>

        {error && <div className="tool-policy-error" role="alert">{error}</div>}

        {rules.length === 0 ? (
          <p className="tool-policy-empty">{t("toolPolicy.empty")}</p>
        ) : (
          <ul className="tool-policy-rules">
            {rules.map((rule) => (
              <li key={rule.id} className="tool-policy-rule">
                <code className="tool-policy-rule-pattern">{rule.pattern}</code>
                <span className={`tool-policy-rule-action is-${rule.action}`}>{t(`toolPolicy.${rule.action}`)}</span>
                {rule.note && <span className="tool-policy-rule-note">{rule.note}</span>}
                <button
                  type="button"
                  className="tool-policy-button is-quiet"
                  disabled={busy}
                  onClick={() => void removeRule(rule.id)}
                  aria-label={`${t("toolPolicy.remove")} ${rule.pattern}`}
                >
                  {t("toolPolicy.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ConfigPanelShell>
  );
}
