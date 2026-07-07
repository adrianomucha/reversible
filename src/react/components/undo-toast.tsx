import { useReversible } from "../use-reversible";
import { CountdownRing } from "./countdown-ring";

export type UndoToastPosition = "bottom-left" | "bottom-center" | "bottom-right" | "top-left" | "top-center" | "top-right";

export interface UndoToastProps {
  /** Corner of the viewport to stack toasts in. Default: "bottom-right". */
  position?: UndoToastPosition;
  /** Maximum toasts shown at once, oldest first. Default: 3. */
  max?: number;
}

/**
 * Gmail-style stack of pending actions, each with a countdown ring and an
 * Undo button. Drop once near the root of your app.
 */
export function UndoToast({ position = "bottom-right", max = 3 }: UndoToastProps) {
  const { actions, controlsFor } = useReversible();
  const pending = actions.filter((action) => action.phase === "pending").slice(0, max);

  // The live region stays mounted even when empty so screen readers announce
  // new toasts, and undo never steals focus from the user's current task.
  return (
    <div className={`rev-toast-stack rev-pos-${position}`} aria-live="polite" role="status">
      {pending.map((action) => (
        <div key={action.id} className="rev-toast" data-severity={action.severity}>
          <CountdownRing progress={action.progress} remaining={action.remaining} size={28} strokeWidth={2.5} />
          <span className="rev-toast-desc">{action.description}</span>
          <button
            type="button"
            className="rev-btn rev-btn-undo"
            onClick={() => controlsFor(action.id).undo()}
          >
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
