import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  GitBranch as GitBranchIcon,
  Plus,
  ExternalLink,
  Search,
} from "lucide-react";
import { useContextStore } from "../../stores/contextStore";
import { useUiStore } from "../../stores/uiStore";
import type { Context } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

function relativeTime(dateStr: string, justNowLabel: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return justNowLabel;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const STYLES = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 10001,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(16px)",
    display: "flex",
    justifyContent: "center",
    paddingTop: "min(120px, 16vh)",
  },
  card: {
    width: "min(480px, calc(100% - 40px))",
    maxHeight: "min(420px, 60vh)",
    borderRadius: "var(--radius-lg)",
    background: "rgba(14,14,16,0.95)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.08), 0 24px 68px rgba(0,0,0,0.55)",
    display: "grid",
    gridTemplateRows: "auto 1fr auto",
    overflow: "hidden",
    animation: "slide-up 180ms cubic-bezier(0.16,1,0.3,1) both",
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  inputIcon: {
    color: "var(--text-3)",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    fontSize: 15,
    color: "var(--text-1)",
    fontFamily: "inherit",
  },
  list: {
    overflowY: "auto" as const,
    padding: "6px 0",
  },
  item: (active: boolean) => ({
    display: "grid",
    gridTemplateColumns: "24px 1fr auto",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    width: "100%",
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left" as const,
    color: "var(--text-1)",
    fontSize: 13,
    fontFamily: "inherit",
    borderRadius: 0,
  }),
  icon: {
    color: "var(--text-3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-3)",
    flexShrink: 0,
  },
  prBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 5px",
    borderRadius: "var(--radius-sm)",
    background: "rgba(255,255,255,0.06)",
    fontSize: 10,
    color: "var(--text-2)",
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--color-accent)",
    flexShrink: 0,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 16px",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    fontSize: 11,
    color: "var(--text-3)",
  },
  footerAction: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--color-accent)",
    fontSize: 11,
    fontFamily: "inherit",
    padding: 0,
  },
  hint: {
    display: "flex",
    gap: 12,
  },
  kbd: {
    padding: "1px 5px",
    borderRadius: 3,
    background: "rgba(255,255,255,0.06)",
    fontSize: 10,
    fontFamily: "inherit",
  },
};

export function ContextSwitcherPalette({ open, onClose }: Props) {
  const { t } = useTranslation("app");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const openCreateModal = useUiStore((s) => s.openContextCreateModal);
  const contexts = useContextStore((s) => s.contexts);
  const activeContextId = useContextStore((s) => s.activeContextId);
  const switchContext = useContextStore((s) => s.switchContext);

  const filtered = query
    ? contexts.filter(
        (c) =>
          c.displayName.toLowerCase().includes(query.toLowerCase()) ||
          c.branchName.toLowerCase().includes(query.toLowerCase()),
      )
    : contexts;

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Keep activeIndex in bounds
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex]);

  // Scroll active item into view
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleSelect = useCallback(
    async (ctx: Context) => {
      onClose();
      if (ctx.id !== activeContextId) {
        await switchContext(ctx.id);
      }
    },
    [onClose, activeContextId, switchContext],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[activeIndex]) {
            void handleSelect(filtered[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, activeIndex, handleSelect, onClose],
  );

  if (!open) return null;

  return createPortal(
    <div style={STYLES.backdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("contexts.switcher.title")}
        style={STYLES.card}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Input row */}
        <div style={STYLES.inputRow}>
          <span style={STYLES.inputIcon}>
            <Search size={18} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("contexts.switcher.placeholder")}
            style={STYLES.input}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Results */}
        <div style={STYLES.list}>
          {filtered.map((ctx, i) => (
            <button
              key={ctx.id}
              ref={i === activeIndex ? activeItemRef : undefined}
              style={STYLES.item(i === activeIndex)}
              onClick={() => void handleSelect(ctx)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span style={STYLES.icon}>
                {ctx.id === activeContextId ? (
                  <span style={STYLES.activeDot} />
                ) : (
                  <GitBranchIcon size={14} />
                )}
              </span>
              <span style={STYLES.label}>{ctx.displayName}</span>
              <span style={STYLES.meta}>
                {ctx.prNumber != null && (
                  <span style={STYLES.prBadge}>
                    <ExternalLink size={9} />
                    #{ctx.prNumber}
                  </span>
                )}
                {ctx.id === activeContextId
                  ? t("contexts.switcher.activeNow")
                  : relativeTime(ctx.lastActiveAt, t("contexts.switcher.justNow"))}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              {query
                ? t("contexts.switcher.noMatch")
                : t("contexts.indicator.noContexts")}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={STYLES.footer}>
          <button
            style={STYLES.footerAction}
            onClick={() => openCreateModal()}
          >
            <Plus size={12} />
            {t("contexts.switcher.newContext")}
          </button>
          <div style={STYLES.hint}>
            <span>
              <span style={STYLES.kbd}>↑↓</span> {t("contexts.switcher.hintNavigate")}
            </span>
            <span>
              <span style={STYLES.kbd}>↵</span> {t("contexts.switcher.hintSwitch")}
            </span>
            <span>
              <span style={STYLES.kbd}>esc</span> {t("contexts.switcher.hintClose")}
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
