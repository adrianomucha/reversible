import { useCallback, useSyncExternalStore } from "react";
import type { ActionControls, ProposeInput, ReadonlyAction } from "../core";
import { useReversibleEngine } from "./provider";

export interface UseReversibleResult {
  /** Register an intention. Returns the action id and its controls. */
  propose: (input: ProposeInput) => { id: string; controls: ActionControls };
  /** Reactive list of proposed and pending actions, oldest first. */
  actions: readonly ReadonlyAction[];
  /** Controls for any action by id. */
  controlsFor: (id: string) => ActionControls;
}

/** Propose actions and observe the active queue. */
export function useReversible(): UseReversibleResult {
  const engine = useReversibleEngine();
  const subscribe = useCallback((listener: () => void) => engine.subscribe(listener), [engine]);
  const getSnapshot = useCallback(() => engine.getActiveSnapshot(), [engine]);
  const actions = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const propose = useCallback((input: ProposeInput) => engine.propose(input), [engine]);
  const controlsFor = useCallback((id: string) => engine.controlsFor(id), [engine]);

  return { propose, actions, controlsFor };
}

export interface UseReversibleActionResult {
  /** Live snapshot of the action, or undefined if unknown or pruned. */
  action: ReadonlyAction | undefined;
  controls: ActionControls;
}

/** Observe and control a single action by id. */
export function useReversibleAction(id: string): UseReversibleActionResult {
  const engine = useReversibleEngine();
  const subscribe = useCallback((listener: () => void) => engine.subscribe(listener), [engine]);
  const getSnapshot = useCallback(() => engine.getAction(id), [engine, id]);
  const action = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { action, controls: engine.controlsFor(id) };
}
