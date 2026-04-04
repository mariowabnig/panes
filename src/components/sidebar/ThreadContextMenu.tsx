import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  Archive,
  Circle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Check,
  Pin,
  PinOff,
} from "lucide-react";
import type { Thread } from "../../types";
import type { ThreadUserStatus } from "../../types";
import { getThreadUserStatus } from "../../stores/threadStore";

interface ThreadContextMenuProps {
  thread: Thread;
  position: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onArchive: () => void;
  onSetStatus: (status: ThreadUserStatus | null) => void;
  onTogglePin: () => void;
}

const USER_STATUSES: { value: ThreadUserStatus; label: string; color: string }[] = [
  { value: "backlog", label: "Backlog", color: "var(--text-3)" },
  { value: "in_progress", label: "In Progress", color: "#facc15" },
  { value: "in_review", label: "In Review", color: "#4ade80" },
  { value: "done", label: "Done", color: "#22c55e" },
  { value: "canceled", label: "Canceled", color: "#f87171" },
];

function StatusIcon({ status, size = 13 }: { status: ThreadUserStatus; size?: number }) {
  if (status === "done") {
    return <CheckCircle2 size={size} style={{ color: "#22c55e" }} />;
  }
  if (status === "canceled") {
    return <XCircle size={size} style={{ color: "#f87171" }} />;
  }
  const color =
    status === "in_progress" ? "#facc15" :
    status === "in_review" ? "#4ade80" :
    "var(--text-3)";
  return <Circle size={size} style={{ color }} />;
}

export function ThreadContextMenu({
  thread,
  position,
  onClose,
  onRename,
  onArchive,
  onSetStatus,
  onTogglePin,
}: ThreadContextMenuProps) {
  const isPinned = thread.pinnedAt != null;
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const statusItemRef = useRef<HTMLButtonElement>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState({ top: 0, left: 0 });
  const activeStatus = getThreadUserStatus(thread);

  const close = useCallback(() => {
    setSubmenuOpen(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || submenuRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close]);

  function handleItem(action: () => void) {
    close();
    action();
  }

  function clampToViewport(x: number, y: number, width: number, height: number) {
    const pad = 8;
    return {
      left: Math.min(x, window.innerWidth - width - pad),
      top: Math.min(y, window.innerHeight - height - pad),
    };
  }

  const menuWidth = 180;
  const menuHeight = 120; // approximate: 3 items + divider
  const clampedMenu = clampToViewport(position.x, position.y, menuWidth, menuHeight);

  function handleStatusHover() {
    if (submenuOpen) return;
    const rect = statusItemRef.current?.getBoundingClientRect();
    if (rect) {
      const subWidth = 160;
      const subHeight = 220; // approximate: 5 statuses + optional clear + divider
      const rawLeft = rect.right + 4;
      const rawTop = rect.top;
      // If submenu overflows right, flip to left side
      const left = rawLeft + subWidth > window.innerWidth - 8
        ? rect.left - subWidth - 4
        : rawLeft;
      const top = Math.min(rawTop, window.innerHeight - subHeight - 8);
      setSubmenuPos({ top, left });
    }
    setSubmenuOpen(true);
  }

  return createPortal(
    <>
      <div
        ref={menuRef}
        className="git-action-menu"
        style={{ position: "fixed", top: clampedMenu.top, left: clampedMenu.left, minWidth: menuWidth, zIndex: 9999 }}
      >
        <button
          type="button"
          className="git-action-menu-item"
          onClick={() => handleItem(onRename)}
        >
          <Pencil size={13} />
          Rename
        </button>
        <button
          ref={statusItemRef}
          type="button"
          className="git-action-menu-item"
          onMouseEnter={handleStatusHover}
        >
          {activeStatus ? <StatusIcon status={activeStatus} /> : <Circle size={13} style={{ color: "var(--text-3)" }} />}
          Set status
          <ChevronRight size={11} style={{ marginLeft: "auto" }} />
        </button>
        <button
          type="button"
          className="git-action-menu-item"
          onClick={() => handleItem(onTogglePin)}
        >
          {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          {isPinned ? "Unpin" : "Pin to top"}
        </button>
        <div className="git-action-menu-divider" />
        <button
          type="button"
          className="git-action-menu-item git-action-menu-item-danger"
          onClick={() => handleItem(onArchive)}
        >
          <Archive size={13} />
          Archive
        </button>
      </div>

      {submenuOpen &&
        createPortal(
          <div
            ref={submenuRef}
            className="git-action-menu"
            style={{ position: "fixed", top: submenuPos.top, left: submenuPos.left, minWidth: 160, zIndex: 10000 }}
            onMouseLeave={() => setSubmenuOpen(false)}
          >
            {activeStatus && (
              <>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => handleItem(() => onSetStatus(null))}
                >
                  <span className="git-action-menu-item-check" />
                  <Circle size={13} style={{ color: "var(--text-3)" }} />
                  No status
                </button>
                <div className="git-action-menu-divider" />
              </>
            )}
            {USER_STATUSES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className="git-action-menu-item"
                onClick={() => handleItem(() => onSetStatus(value))}
              >
                {activeStatus === value
                  ? <Check size={13} />
                  : <span className="git-action-menu-item-check" />
                }
                <StatusIcon status={value} />
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>,
    document.body,
  );
}

export { StatusIcon };
