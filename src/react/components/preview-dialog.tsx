import { useEffect, useRef, type KeyboardEvent } from "react";
import { useReversible } from "../use-reversible";
import { ActionDiff } from "./action-diff";

export interface PreviewDialogProps {
  /** Label for the button that approves the action. Default: "Confirm". */
  confirmLabel?: string;
  /** Label for the button that rejects the action. Default: "Cancel". */
  cancelLabel?: string;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The confirm gate for proposed actions. Shows the oldest proposed action
 * with its diff and Confirm/Cancel buttons. Modal: traps focus, starts on
 * the safe (cancel) action, Esc cancels, and focus is restored on close.
 */
export function PreviewDialog({ confirmLabel = "Confirm", cancelLabel = "Cancel" }: PreviewDialogProps) {
  const { actions, controlsFor } = useReversible();
  const action = actions.find((a) => a.phase === "proposed");
  const actionId = action?.id;

  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!actionId) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The cancel button is the safe default for a consequential action.
    cancelRef.current?.focus();
    return () => {
      restoreRef.current?.focus();
      restoreRef.current = null;
    };
  }, [actionId]);

  if (!action) return null;
  const controls = controlsFor(action.id);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controls.reject();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute("disabled"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="rev-overlay">
      <div
        ref={dialogRef}
        className="rev-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`rev-dialog-title-${action.id}`}
        aria-describedby={`rev-dialog-desc-${action.id}`}
        data-severity={action.severity}
        onKeyDown={handleKeyDown}
      >
        <p className="rev-dialog-kicker">Review before it runs</p>
        <h2 className="rev-dialog-title" id={`rev-dialog-title-${action.id}`}>
          {action.intent}
        </h2>
        <p className="rev-dialog-desc" id={`rev-dialog-desc-${action.id}`}>
          {action.description}
        </p>
        <ActionDiff diff={action.diff} />
        <div className="rev-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="rev-btn rev-btn-cancel"
            onClick={() => controls.reject()}
          >
            {cancelLabel}
          </button>
          <button type="button" className="rev-btn rev-btn-confirm" onClick={() => controls.confirm()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
