# takeback

The undo button for agents.

`takeback` puts a preview-and-undo layer around any consequential AI action. Most undo tries to reverse an effect that already happened. `takeback` defers the irreversible for a grace window instead. During the window nothing has actually happened, so undo is free. It just cancels a pending intention. This is "Undo Send", generalized to any agent action.

- **Headless core.** Zero dependencies, zero React imports. Works in Node, vanilla JS, or any framework.
- **React bindings.** A provider, hooks, and four drop-in components: undo toast, preview dialog, countdown ring, action diff.
- **Severity-aware.** Low and medium severity actions run optimistically with an undo window. High severity actions wait behind a confirm gate.
- **Accessible.** Focus-trapped alert dialog, polite live regions, reduced-motion support.

## How it works

```
proposed ──confirm──▶ pending ──(grace elapses)──▶ committed
   │                    │
 reject                undo
   ▼                    ▼
 rejected             undone
```

The real effect (`onCommit`) fires only on the `pending → committed` transition. Never on propose. Never on optimistic apply. Undo during the window means the effect never runs at all.

## Install

```bash
npm install takeback
```

React 18+ is an optional peer dependency. The core works without it.

## Quick start (React)

```tsx
import { ReversibleProvider, UndoToast, PreviewDialog, useReversible } from "takeback";
import "takeback/styles.css"; // optional default styling

function App() {
  return (
    <ReversibleProvider defaultGrace={8000}>
      <Agent />
      <UndoToast position="bottom-right" />
      <PreviewDialog />
    </ReversibleProvider>
  );
}

function Agent() {
  const { propose } = useReversible();

  const sendEmail = () =>
    propose({
      intent: "send-email",
      description: "Send follow-up email to 3 clients",
      severity: "medium", // straight to pending, 8s undo window
      onCommit: async () => {
        await api.sendEmails(); // runs only if nobody hits Undo
      },
    });

  const deleteFiles = () =>
    propose({
      intent: "delete-files",
      description: "Delete 12 stale build files",
      severity: "high", // held at proposed until confirmed in PreviewDialog
      diff: {
        summary: "12 files, 148 MB total",
        entries: [{ label: "cache/chunk-001.js.map", before: "cache/chunk-001.js.map" }],
      },
      onCommit: async () => {
        await api.deleteFiles();
      },
      onUndo: () => toastInfo("Nothing was deleted."),
    });

  return <button onClick={sendEmail}>Run agent</button>;
}
```

## Quick start (no React)

The core is framework-agnostic. Import it from `takeback/core`:

```ts
import { ReversibleEngine } from "takeback/core";

const engine = new ReversibleEngine({ defaultGrace: 8000 });

const { id, controls } = engine.propose({
  intent: "send-email",
  description: "Send follow-up email",
  onCommit: () => api.send(),
});

engine.subscribe(() => {
  const active = engine.getActiveSnapshot();
  render(active); // your UI here
});

controls.undo(); // cancels before the window closes; onCommit never runs
```

## API

### `ReversibleEngine`

```ts
new ReversibleEngine(options?: EngineOptions)
```

| Option | Default | Description |
| --- | --- | --- |
| `defaultGrace` | `8000` | Grace window in ms for actions that do not set `grace`. |
| `tickInterval` | `100` | How often `remaining`/`progress` update while actions are pending. |
| `now` | `() => Date.now()` | Clock injection point for deterministic tests. |
| `onCommitError` | logs to console | Called when `onCommit` throws or rejects. The queue keeps running. |

Methods:

- `propose(input: ProposeInput) → { id, controls }`. Registers an intention. High severity or `requireConfirm: true` lands in `proposed`; everything else goes straight to `pending` and the countdown starts.
- `subscribe(listener) → unsubscribe`. Fires on every state change, including timer ticks.
- `controlsFor(id) → ActionControls`. `{ confirm, reject, undo, commitNow }`. Invalid transitions are no-ops.
- `getActive()`. Fresh snapshots of proposed and pending actions.
- `getActiveSnapshot()`. Version-cached view of the same list. Stable reference until state changes, safe for `useSyncExternalStore`.
- `getAction(id)`. Snapshot of one action, or `undefined`.
- `advance(ms)`. Moves the engine clock forward. Deterministic test driver.
- `prune()`. Drops finished actions from memory.
- `dispose()`. Stops the timer and clears listeners. Pending effects never run.

### `ProposeInput`

| Field | Type | Notes |
| --- | --- | --- |
| `intent` | `string` | Short name, e.g. `"delete-files"`. |
| `description` | `string` | Human-readable sentence shown in UI. |
| `severity?` | `"low" \| "medium" \| "high"` | Default `"medium"`. |
| `diff?` | `Diff` | `{ summary?, entries?: { label, before?, after? }[] }`. |
| `meta?` | `Record<string, unknown>` | Anything you want to carry along. |
| `grace?` | `number` | Window in ms. Defaults to the engine's `defaultGrace`. |
| `requireConfirm?` | `boolean` | Defaults to `severity === "high"`. |
| `onCommit` | `(action) => void \| Promise<void>` | The real effect. Runs once, only on commit. |
| `onUndo?` | `(action) => void` | Called on undo. The effect never ran. |
| `onReject?` | `(action) => void` | Called on reject. The effect never ran. |

### React

- `<ReversibleProvider defaultGrace? tickInterval? engine?>`. Creates or accepts an engine, shares it via context, disposes engines it owns on unmount.
- `useReversible() → { propose, actions, controlsFor }`. `actions` is the reactive list of proposed and pending actions.
- `useReversibleAction(id) → { action, controls }`. Observe and control one action.
- `useReversibleEngine() → ReversibleEngine`. Escape hatch to the raw engine.

Components:

- `<UndoToast position? max? />`. Stack of pending actions with countdown rings and Undo buttons. Drop once near the root. `position` defaults to `"bottom-right"`, `max` to `3`.
- `<PreviewDialog confirmLabel? cancelLabel? />`. The confirm gate for proposed actions. Focus-trapped `alertdialog`, focuses Cancel by default, Esc rejects, restores focus on close.
- `<CountdownRing progress remaining size? strokeWidth? />`. SVG timer.
- `<ActionDiff diff? />`. Renders a `Diff` in human-readable form.

Styling is opt-in. Import `takeback/styles.css` for defaults, or target the `rev-*` classes yourself. Animations respect `prefers-reduced-motion`.

## Demo

`demo/index.html` is a standalone, dependency-free page. Open it in a browser, no build needed. An agent proposes deleting 12 files, you review it, confirm it, and get a 6 second undo window before anything actually happens.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsup → dist/
```

Engine tests use an injected clock and `engine.advance(ms)`, so they run deterministically with no real timers.

## License

MIT. See [LICENSE](./LICENSE).
