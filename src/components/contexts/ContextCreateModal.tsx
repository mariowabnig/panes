import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useContextStore } from "../../stores/contextStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

const STYLES = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 10002,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(16px)",
    display: "flex",
    justifyContent: "center",
    paddingTop: "min(100px, 12vh)",
  },
  card: {
    width: "min(480px, calc(100% - 40px))",
    borderRadius: "var(--radius-lg)",
    background: "rgba(14,14,16,0.97)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.08), 0 24px 68px rgba(0,0,0,0.55)",
    padding: "24px",
    animation: "slide-up 180ms cubic-bezier(0.16,1,0.3,1) both",
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--text-1)",
    marginBottom: 20,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-2)",
    marginBottom: 5,
  },
  input: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "var(--text-1)",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  select: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "var(--text-1)",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 20,
  },
  btnCancel: {
    padding: "7px 16px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent",
    color: "var(--text-2)",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  btnCreate: {
    padding: "7px 16px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "var(--color-accent)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    opacity: 1,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
};

export function ContextCreateModal({ open, onClose }: Props) {
  const { t } = useTranslation("app");
  const createContext = useContextStore((s) => s.createContext);
  const isCreating = useContextStore((s) => s.isCreating);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeRepoId = useWorkspaceStore((s) => s.activeRepoId);
  const repos = useWorkspaceStore((s) => s.repos);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setBranchName("");
      setBaseBranch(activeRepo?.defaultBranch ?? "main");
      setDisplayName("");
      setPrUrl("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, activeRepo?.defaultBranch]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [open, onClose]);

  // Auto-derive display name from branch
  useEffect(() => {
    if (!branchName) {
      setDisplayName("");
      return;
    }
    const derived = branchName
      .replace(/^(fix|feat|feature|hotfix|chore|refactor|docs|test)[/\\-]/, "")
      .replace(/[/\\-]/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
    setDisplayName(derived);
  }, [branchName]);

  const canCreate = branchName.trim().length > 0 && !isCreating;

  const handleCreate = async () => {
    if (!canCreate || !activeWorkspaceId || !activeRepoId) return;

    const parsedPrNumber = prUrl
      ? parseInt(prUrl.match(/\/pull\/(\d+)/)?.[1] ?? "", 10) || undefined
      : undefined;

    const result = await createContext({
      workspaceId: activeWorkspaceId,
      repoId: activeRepoId,
      branchName: branchName.trim(),
      baseBranch: baseBranch || undefined,
      displayName: displayName.trim() || undefined,
      prUrl: prUrl.trim() || undefined,
      prNumber: parsedPrNumber,
    });
    if (result) onClose();
  };

  if (!open) return null;

  return createPortal(
    <div style={STYLES.backdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        style={STYLES.card}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={STYLES.title}>{t("contexts.create.title")}</div>

        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.branchName")}</label>
          <input
            ref={inputRef}
            style={STYLES.input}
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder={t("contexts.create.branchNamePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) void handleCreate();
            }}
          />
        </div>

        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.baseBranch")}</label>
          <input
            style={STYLES.input}
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
          />
        </div>

        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.displayName")}</label>
          <input
            style={STYLES.input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("contexts.create.displayNamePlaceholder")}
          />
        </div>

        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.prUrl")}</label>
          <input
            style={STYLES.input}
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder={t("contexts.create.prUrlPlaceholder")}
          />
        </div>

        <div style={STYLES.actions}>
          <button style={STYLES.btnCancel} onClick={onClose}>
            {t("contexts.create.cancel")}
          </button>
          <button
            style={{
              ...STYLES.btnCreate,
              ...(canCreate ? {} : STYLES.btnDisabled),
            }}
            disabled={!canCreate}
            onClick={() => void handleCreate()}
          >
            {isCreating
              ? t("contexts.create.creating")
              : t("contexts.create.create")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
