/** How consequential an action is. High severity requires explicit confirmation by default. */
export type Severity = "low" | "medium" | "high";

/**
 * Lifecycle of an action.
 *
 * proposed ──confirm──▶ pending ──(grace elapses)──▶ committed
 *    │                    │
 *  reject                undo
 *    ▼                    ▼
 *  rejected             undone
 */
export type Phase = "proposed" | "pending" | "committed" | "undone" | "rejected";

export interface DiffEntry {
  label: string;
  before?: string;
  after?: string;
}

/** A human-readable description of what the action will change. */
export interface Diff {
  summary?: string;
  entries?: DiffEntry[];
}

/** Immutable snapshot of an action, safe to hand to UI code. */
export interface ReadonlyAction {
  id: string;
  intent: string;
  description: string;
  severity: Severity;
  diff?: Diff;
  meta?: Record<string, unknown>;
  phase: Phase;
  /** Grace window in milliseconds. */
  grace: number;
  /** Milliseconds left in the grace window. Equals `grace` before the window starts. */
  remaining: number;
  /** Elapsed fraction of the grace window, 0 at start and 1 at commit. */
  progress: number;
  requiresConfirm: boolean;
  createdAt: number;
}

export interface ProposeInput {
  /** Short machine-ish name for the action, e.g. "delete-files". */
  intent: string;
  /** Human-readable sentence shown in UI, e.g. "Delete 12 files". */
  description: string;
  /** Defaults to "medium". */
  severity?: Severity;
  diff?: Diff;
  meta?: Record<string, unknown>;
  /** Grace window in milliseconds. Defaults to the engine's `defaultGrace`. */
  grace?: number;
  /** Hold at `proposed` until confirmed. Defaults to `severity === "high"`. */
  requireConfirm?: boolean;
  /**
   * The real, irreversible effect. Runs only on the `pending -> committed`
   * transition. Never on propose, never on optimistic apply. May be async.
   */
  onCommit: (action: ReadonlyAction) => void | Promise<void>;
  /** Called when a pending action is undone. The effect never ran. */
  onUndo?: (action: ReadonlyAction) => void;
  /** Called when a proposed action is rejected. The effect never ran. */
  onReject?: (action: ReadonlyAction) => void;
}

/** Controls for a single action. Each is a no-op if the action is not in a valid phase for it. */
export interface ActionControls {
  /** proposed -> pending. Starts the grace window. */
  confirm: () => void;
  /** proposed -> rejected. Calls `onReject`. */
  reject: () => void;
  /** pending -> undone. Calls `onUndo`. The effect never runs. */
  undo: () => void;
  /** pending -> committed immediately, skipping the rest of the window. */
  commitNow: () => void;
}

export interface EngineOptions {
  /** Default grace window in milliseconds. Default: 8000. */
  defaultGrace?: number;
  /** How often the internal timer updates `remaining`/`progress`. Default: 100ms. */
  tickInterval?: number;
  /** Clock injection point. Default: `() => Date.now()`. */
  now?: () => number;
  /**
   * Called when `onCommit` throws or rejects. The action stays committed and
   * the queue keeps running. Default: logs via `console.error`.
   */
  onCommitError?: (error: unknown, action: ReadonlyAction) => void;
}
