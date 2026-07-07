# reversible: specification

## Intent

Put a preview-and-undo layer around any consequential AI action. Most undo tries to reverse an effect that already happened. `reversible` defers the irreversible for a grace window. During the window nothing has actually happened, so undo is free. It cancels a pending intention. This is "Undo Send", generalized to any agent action.

## State machine

```
proposed ──confirm──▶ pending ──(grace elapses)──▶ committed
   │                    │
 reject                undo
   ▼                    ▼
 rejected             undone
```

Rules:

1. `low` and `medium` severity actions go straight to `pending`. The grace window starts immediately.
2. `high` severity actions (or any action with `requireConfirm: true`) are held at `proposed` behind a confirm gate until the user approves.
3. `onCommit`, the real irreversible effect, fires only on the `pending → committed` transition. Never on propose. Never on optimistic apply.
4. `undo` during the window moves the action to `undone`. The effect never runs.
5. `reject` at the gate moves the action to `rejected`. The effect never runs.
6. `commitNow` skips the rest of the window and commits immediately.
7. `committed`, `undone`, and `rejected` are terminal.

## Core engine (`src/core`)

Framework-agnostic. Zero runtime dependencies. Zero React imports. Usable from Node, vanilla JS, or any framework.

### Types

- `Severity = "low" | "medium" | "high"`
- `Phase = "proposed" | "pending" | "committed" | "undone" | "rejected"`
- `Diff = { summary?: string; entries?: { label: string; before?: string; after?: string }[] }`
- `ProposeInput`: `intent`, `description`, `severity?` (default `"medium"`), `diff?`, `meta?`, `grace?` (ms), `requireConfirm?` (defaults to `severity === "high"`), `onCommit(action)` (may be async), `onUndo?(action)`, `onReject?(action)`.
- `ReadonlyAction`: immutable snapshot with `id`, `intent`, `description`, `severity`, `diff`, `meta`, `phase`, `grace`, `remaining`, `progress` (0..1 elapsed fraction), `requiresConfirm`, `createdAt`.
- `ActionControls = { confirm, reject, undo, commitNow }`.
- `EngineOptions = { defaultGrace = 8000, tickInterval = 100, now = () => Date.now(), onCommitError? }`.

### `ReversibleEngine`

- `propose(input) → { id, controls }`.
- `subscribe(listener) → unsubscribe`. Fires on every state change, including ticks while actions are pending.
- `controlsFor(id) → ActionControls`. Controls are safe in any phase; invalid transitions are no-ops.
- A ticking timer drives `remaining` and `progress` and commits any action whose window elapsed. The timer stops when nothing is pending.
- Clock is injected via `now`. `advance(ms)` moves engine time forward and processes elapsed windows, so tests run deterministically without real timers.
- `getActive()` returns proposed plus pending. `getActiveSnapshot()` is version-cached: it returns a stable reference until state changes, which `useSyncExternalStore` requires. `getAction(id)` is also referentially stable.
- `prune()` drops finished actions. `dispose()` stops the timer and clears listeners without committing anything.
- Errors thrown or rejected by `onCommit` go to `onCommitError` (console by default). The action stays committed and the queue keeps running.

## React layer (`src/react`)

Thin bindings over the engine. Components read engine state and render it. They stay dumb.

- `ReversibleProvider`: creates or accepts an engine (`engine`, `defaultGrace`, `tickInterval` props), shares it via context, disposes engines it owns on unmount.
- `useReversible() → { propose, actions, controlsFor }` where `actions` comes from `useSyncExternalStore(subscribe, getActiveSnapshot)`.
- `useReversibleAction(id) → { action, controls }`.
- `UndoToast` (`position`, `max`): stack of pending actions, each with a `CountdownRing` and an Undo button. Persistent `aria-live="polite"` region. Never steals focus.
- `PreviewDialog` (`confirmLabel`, `cancelLabel`): confirm gate for the oldest proposed action. `role="alertdialog"`, `aria-modal`, focus trap, Cancel focused by default, Esc rejects, focus restored on close.
- `CountdownRing` (`progress`, `remaining`, `size`, `strokeWidth`): SVG timer.
- `ActionDiff` (`diff`): human-readable before/after rendering.
- `styles.css`: optional defaults, class-prefixed `rev-*`, honors `prefers-reduced-motion`.

## Package

- TypeScript, strict. ESM-only output via tsup with `.d.ts`.
- Exports: `"."` (core + react), `"./core"` (engine only), `"./styles.css"`.
- `react` is an optional peer dependency. The core must work without it.
- MIT license.

## Non-goals for v1

- Persistence of pending actions across page reloads.
- Server-side or multi-client coordination of grace windows.
- Automatic rollback of effects that already committed.
