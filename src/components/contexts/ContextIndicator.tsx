import { useTranslation } from "react-i18next";
import { GitBranch as GitBranchIcon } from "lucide-react";
import { useContextStore } from "../../stores/contextStore";
import { useUiStore } from "../../stores/uiStore";

const STYLES = {
  root: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 8px",
    borderRadius: "var(--radius-sm)",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "inherit",
    color: "var(--text-2)",
    maxWidth: "100%",
    overflow: "hidden",
    transition: "background 120ms ease",
  },
  rootHover: {
    background: "rgba(255,255,255,0.08)",
  },
  label: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    fontWeight: 500,
  },
  icon: {
    flexShrink: 0,
    color: "var(--text-3)",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "var(--color-accent)",
    flexShrink: 0,
  },
};

export function ContextIndicator() {
  const { t } = useTranslation("app");
  const activeContextId = useContextStore((s) => s.activeContextId);
  const contexts = useContextStore((s) => s.contexts);
  const activeContext = contexts.find((c) => c.id === activeContextId) ?? null;
  const openSwitcher = useUiStore((s) => s.openContextSwitcher);

  // Don't show if there's only the default context (or none)
  const nonDefaultContexts = contexts.filter((c) => c.worktreePath !== null);
  if (nonDefaultContexts.length === 0 && !activeContext?.worktreePath) {
    return null;
  }

  const displayName = activeContext?.worktreePath
    ? activeContext.displayName
    : t("contexts.indicator.mainContext");

  return (
    <button
      style={STYLES.root}
      onClick={openSwitcher}
      title={t("contexts.indicator.switchContext")}
      onMouseEnter={(e) => {
        Object.assign(e.currentTarget.style, STYLES.rootHover);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = STYLES.root.background;
      }}
    >
      <GitBranchIcon size={12} style={STYLES.icon} />
      <span style={STYLES.label}>{displayName}</span>
      {activeContext?.worktreePath && <span style={STYLES.dot} />}
    </button>
  );
}
