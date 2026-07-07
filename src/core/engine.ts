import type {
  ActionControls,
  Diff,
  EngineOptions,
  Phase,
  ProposeInput,
  ReadonlyAction,
  Severity,
} from "./types";

interface InternalAction {
  id: string;
  intent: string;
  description: string;
  severity: Severity;
  diff?: Diff;
  meta?: Record<string, unknown>;
  grace: number;
  requiresConfirm: boolean;
  createdAt: number;
  phase: Phase;
  /** Timestamp when the action entered `pending`, in engine time. */
  pendingAt: number | null;
  onCommit: ProposeInput["onCommit"];
  onUndo?: ProposeInput["onUndo"];
  onReject?: ProposeInput["onReject"];
  /** Cached snapshot once the action reaches a terminal phase. */
  finalSnapshot?: ReadonlyAction;
}

const ACTIVE_PHASES: readonly Phase[] = ["proposed", "pending"];
const EMPTY_SNAPSHOT: readonly ReadonlyAction[] = Object.freeze([]);

/**
 * Framework-agnostic state machine that defers irreversible effects behind a
 * grace window. During the window nothing has happened yet, so undo is free:
 * it just cancels a pending intention.
 */
export class ReversibleEngine {
  private readonly defaultGrace: number;
  private readonly tickInterval: number;
  private readonly nowFn: () => number;
  private readonly onCommitError: (error: unknown, action: ReadonlyAction) => void;

  private actions = new Map<string, InternalAction>();
  private listeners = new Set<() => void>();
  private version = 0;
  private snapshotVersion = -1;
  private snapshotCache: readonly ReadonlyAction[] = EMPTY_SNAPSHOT;
  private timeOffset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private idCounter = 0;

  constructor(options: EngineOptions = {}) {
    this.defaultGrace = options.defaultGrace ?? 8000;
    this.tickInterval = options.tickInterval ?? 100;
    this.nowFn = options.now ?? (() => Date.now());
    this.onCommitError =
      options.onCommitError ??
      ((error, action) => {
        console.error(`[takeback] onCommit failed for "${action.intent}" (${action.id})`, error);
      });
  }

  /** Current engine time: injected clock plus any `advance()` offset. */
  private now(): number {
    return this.nowFn() + this.timeOffset;
  }

  /**
   * Register an intention. Low/medium severity starts the grace window
   * immediately; high severity (or `requireConfirm: true`) is held at
   * `proposed` until confirmed.
   */
  propose(input: ProposeInput): { id: string; controls: ActionControls } {
    const severity = input.severity ?? "medium";
    const action: InternalAction = {
      id: `rev-${++this.idCounter}`,
      intent: input.intent,
      description: input.description,
      severity,
      diff: input.diff,
      meta: input.meta,
      grace: input.grace ?? this.defaultGrace,
      requiresConfirm: input.requireConfirm ?? severity === "high",
      createdAt: this.now(),
      phase: "proposed",
      pendingAt: null,
      onCommit: input.onCommit,
      onUndo: input.onUndo,
      onReject: input.onReject,
    };
    this.actions.set(action.id, action);
    if (action.requiresConfirm) {
      this.emit();
    } else {
      this.startWindow(action);
    }
    return { id: action.id, controls: this.controlsFor(action.id) };
  }

  /** Controls bound to one action id. Safe to call in any phase; invalid transitions are no-ops. */
  controlsFor(id: string): ActionControls {
    return {
      confirm: () => this.confirm(id),
      reject: () => this.reject(id),
      undo: () => this.undo(id),
      commitNow: () => this.commitNow(id),
    };
  }

  confirm(id: string): void {
    const action = this.actions.get(id);
    if (!action || action.phase !== "proposed") return;
    this.startWindow(action);
  }

  reject(id: string): void {
    const action = this.actions.get(id);
    if (!action || action.phase !== "proposed") return;
    action.phase = "rejected";
    const snapshot = this.snapshotOf(action);
    this.emit();
    action.onReject?.(snapshot);
  }

  undo(id: string): void {
    const action = this.actions.get(id);
    if (!action || action.phase !== "pending") return;
    action.phase = "undone";
    const snapshot = this.snapshotOf(action);
    this.emit();
    action.onUndo?.(snapshot);
  }

  commitNow(id: string): void {
    const action = this.actions.get(id);
    if (!action || action.phase !== "pending") return;
    this.commit(action);
  }

  /** Notified on every state change, including timer ticks while actions are pending. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fresh snapshots of all proposed and pending actions, oldest first. */
  getActive(): ReadonlyAction[] {
    const active: ReadonlyAction[] = [];
    for (const action of this.actions.values()) {
      if (ACTIVE_PHASES.includes(action.phase)) {
        active.push(this.snapshotOf(action));
      }
    }
    return active;
  }

  /**
   * Version-cached view of `getActive()`. Returns the same reference until
   * state changes, so it is safe as a `useSyncExternalStore` snapshot.
   */
  getActiveSnapshot(): readonly ReadonlyAction[] {
    if (this.snapshotVersion !== this.version) {
      const active = this.getActive();
      this.snapshotCache = active.length === 0 ? EMPTY_SNAPSHOT : Object.freeze(active);
      this.snapshotVersion = this.version;
    }
    return this.snapshotCache;
  }

  /**
   * Snapshot of one action, or undefined. Referentially stable: active
   * actions come from the cached active snapshot, terminal actions from a
   * frozen final snapshot.
   */
  getAction(id: string): ReadonlyAction | undefined {
    const action = this.actions.get(id);
    if (!action) return undefined;
    if (ACTIVE_PHASES.includes(action.phase)) {
      return this.getActiveSnapshot().find((a) => a.id === id);
    }
    if (!action.finalSnapshot) {
      action.finalSnapshot = Object.freeze(this.snapshotOf(action));
    }
    return action.finalSnapshot;
  }

  /** Drop finished actions (committed, undone, rejected) from memory. */
  prune(): void {
    let changed = false;
    for (const [id, action] of this.actions) {
      if (!ACTIVE_PHASES.includes(action.phase)) {
        this.actions.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /**
   * Advance the engine clock by `ms` and process anything that elapsed.
   * Deterministic test driver; no real timers involved.
   */
  advance(ms: number): void {
    this.timeOffset += ms;
    this.tick();
  }

  /** Stop the timer and drop listeners. Pending actions are left as-is; their effects never ran. */
  dispose(): void {
    this.stopTimer();
    this.listeners.clear();
  }

  private startWindow(action: InternalAction): void {
    action.phase = "pending";
    action.pendingAt = this.now();
    if (action.grace <= 0) {
      this.commit(action);
      return;
    }
    this.ensureTimer();
    this.emit();
  }

  private commit(action: InternalAction): void {
    if (action.phase !== "pending") return;
    action.phase = "committed";
    const snapshot = this.snapshotOf(action);
    this.emit();
    try {
      const result = action.onCommit(snapshot);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch((error) => this.onCommitError(error, snapshot));
      }
    } catch (error) {
      this.onCommitError(error, snapshot);
    }
  }

  private tick(): void {
    let anyPending = false;
    for (const action of this.actions.values()) {
      if (action.phase !== "pending") continue;
      if (this.remainingOf(action) <= 0) {
        this.commit(action);
      } else {
        anyPending = true;
      }
    }
    if (anyPending) {
      // remaining/progress moved even if nothing committed
      this.emit();
    } else {
      this.stopTimer();
    }
  }

  private remainingOf(action: InternalAction): number {
    if (action.phase !== "pending" || action.pendingAt === null) {
      return action.phase === "proposed" ? action.grace : 0;
    }
    return Math.max(0, action.pendingAt + action.grace - this.now());
  }

  private snapshotOf(action: InternalAction): ReadonlyAction {
    const remaining =
      action.phase === "pending"
        ? this.remainingOf(action)
        : action.phase === "proposed"
          ? action.grace
          : 0;
    const progress =
      action.phase === "committed"
        ? 1
        : action.grace <= 0
          ? 0
          : Math.min(1, Math.max(0, 1 - remaining / action.grace));
    return {
      id: action.id,
      intent: action.intent,
      description: action.description,
      severity: action.severity,
      diff: action.diff,
      meta: action.meta,
      phase: action.phase,
      grace: action.grace,
      remaining,
      progress,
      requiresConfirm: action.requiresConfirm,
      createdAt: action.createdAt,
    };
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), this.tickInterval);
    // Do not hold a Node process open just for countdowns.
    const t = this.timer as unknown as { unref?: () => void };
    t.unref?.();
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    this.version++;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
