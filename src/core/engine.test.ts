import { describe, expect, it, vi } from "vitest";
import { ReversibleEngine } from "./engine";
import type { ReadonlyAction } from "./types";

/** Engine with a frozen injected clock; time moves only via advance(). */
function createEngine(options: ConstructorParameters<typeof ReversibleEngine>[0] = {}) {
  return new ReversibleEngine({ now: () => 0, ...options });
}

describe("deferral", () => {
  it("does not commit until the grace window elapses", () => {
    const engine = createEngine();
    const onCommit = vi.fn();
    engine.propose({ intent: "send", description: "Send email", grace: 8000, onCommit });

    expect(onCommit).not.toHaveBeenCalled();
    engine.advance(7999);
    expect(onCommit).not.toHaveBeenCalled();
    engine.advance(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    engine.advance(10_000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("uses defaultGrace when no grace is given", () => {
    const engine = createEngine({ defaultGrace: 500 });
    const onCommit = vi.fn();
    const { id } = engine.propose({ intent: "a", description: "a", onCommit });

    expect(engine.getAction(id)?.grace).toBe(500);
    engine.advance(499);
    expect(onCommit).not.toHaveBeenCalled();
    engine.advance(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("passes a committed snapshot to onCommit", () => {
    const engine = createEngine();
    let received: ReadonlyAction | undefined;
    engine.propose({
      intent: "send",
      description: "Send email",
      grace: 100,
      onCommit: (action) => {
        received = action;
      },
    });
    engine.advance(100);
    expect(received?.phase).toBe("committed");
    expect(received?.remaining).toBe(0);
    expect(received?.progress).toBe(1);
  });
});

describe("undo", () => {
  it("prevents the commit entirely", () => {
    const engine = createEngine();
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    const { id, controls } = engine.propose({
      intent: "delete",
      description: "Delete 12 files",
      grace: 8000,
      onCommit,
      onUndo,
    });

    engine.advance(4000);
    controls.undo();

    expect(engine.getAction(id)?.phase).toBe("undone");
    expect(onUndo).toHaveBeenCalledTimes(1);
    engine.advance(60_000);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("is a no-op outside of pending", () => {
    const engine = createEngine();
    const onUndo = vi.fn();
    const { id, controls } = engine.propose({
      intent: "x",
      description: "x",
      severity: "high",
      grace: 100,
      onCommit: () => {},
      onUndo,
    });

    controls.undo(); // still proposed
    expect(engine.getAction(id)?.phase).toBe("proposed");
    expect(onUndo).not.toHaveBeenCalled();

    controls.confirm();
    engine.advance(100); // committed
    controls.undo();
    expect(engine.getAction(id)?.phase).toBe("committed");
    expect(onUndo).not.toHaveBeenCalled();
  });
});

describe("confirm gate", () => {
  it("holds high-severity actions at proposed until confirmed", () => {
    const engine = createEngine();
    const onCommit = vi.fn();
    const { id, controls } = engine.propose({
      intent: "drop-table",
      description: "Drop the users table",
      severity: "high",
      grace: 1000,
      onCommit,
    });

    expect(engine.getAction(id)?.phase).toBe("proposed");
    engine.advance(60_000);
    expect(engine.getAction(id)?.phase).toBe("proposed");
    expect(onCommit).not.toHaveBeenCalled();

    controls.confirm();
    expect(engine.getAction(id)?.phase).toBe("pending");
    engine.advance(999);
    expect(onCommit).not.toHaveBeenCalled();
    engine.advance(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("respects an explicit requireConfirm override", () => {
    const engine = createEngine();
    const low = engine.propose({
      intent: "a",
      description: "a",
      severity: "low",
      requireConfirm: true,
      onCommit: () => {},
    });
    const high = engine.propose({
      intent: "b",
      description: "b",
      severity: "high",
      requireConfirm: false,
      onCommit: () => {},
    });
    expect(engine.getAction(low.id)?.phase).toBe("proposed");
    expect(engine.getAction(high.id)?.phase).toBe("pending");
  });
});

describe("reject", () => {
  it("never commits and calls onReject", () => {
    const engine = createEngine();
    const onCommit = vi.fn();
    const onReject = vi.fn();
    const { id, controls } = engine.propose({
      intent: "wipe",
      description: "Wipe cache",
      severity: "high",
      grace: 100,
      onCommit,
      onReject,
    });

    controls.reject();
    expect(engine.getAction(id)?.phase).toBe("rejected");
    expect(onReject).toHaveBeenCalledTimes(1);
    engine.advance(60_000);
    expect(onCommit).not.toHaveBeenCalled();

    controls.confirm(); // rejected is terminal
    expect(engine.getAction(id)?.phase).toBe("rejected");
  });
});

describe("commitNow", () => {
  it("skips the rest of the window and commits once", () => {
    const engine = createEngine();
    const onCommit = vi.fn();
    const { id, controls } = engine.propose({
      intent: "send",
      description: "Send email",
      grace: 8000,
      onCommit,
    });

    engine.advance(1000);
    controls.commitNow();
    expect(engine.getAction(id)?.phase).toBe("committed");
    expect(onCommit).toHaveBeenCalledTimes(1);
    engine.advance(60_000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("progress and remaining", () => {
  it("reports correctly across the window", () => {
    const engine = createEngine();
    const { id } = engine.propose({
      intent: "send",
      description: "Send email",
      grace: 8000,
      onCommit: () => {},
    });

    expect(engine.getAction(id)?.remaining).toBe(8000);
    expect(engine.getAction(id)?.progress).toBe(0);

    engine.advance(2000);
    expect(engine.getAction(id)?.remaining).toBe(6000);
    expect(engine.getAction(id)?.progress).toBeCloseTo(0.25);

    engine.advance(2000);
    expect(engine.getAction(id)?.remaining).toBe(4000);
    expect(engine.getAction(id)?.progress).toBeCloseTo(0.5);

    engine.advance(4000);
    expect(engine.getAction(id)?.phase).toBe("committed");
    expect(engine.getAction(id)?.remaining).toBe(0);
    expect(engine.getAction(id)?.progress).toBe(1);
  });

  it("reports a full window for proposed actions", () => {
    const engine = createEngine();
    const { id } = engine.propose({
      intent: "x",
      description: "x",
      severity: "high",
      grace: 5000,
      onCommit: () => {},
    });
    engine.advance(3000);
    expect(engine.getAction(id)?.remaining).toBe(5000);
    expect(engine.getAction(id)?.progress).toBe(0);
  });
});

describe("snapshots and subscriptions", () => {
  it("getActiveSnapshot is referentially stable until state changes", () => {
    const engine = createEngine();
    engine.propose({ intent: "a", description: "a", grace: 1000, onCommit: () => {} });

    const first = engine.getActiveSnapshot();
    expect(engine.getActiveSnapshot()).toBe(first);

    engine.advance(100);
    const second = engine.getActiveSnapshot();
    expect(second).not.toBe(first);
    expect(engine.getActiveSnapshot()).toBe(second);
  });

  it("getActive returns proposed and pending only", () => {
    const engine = createEngine();
    engine.propose({ intent: "p", description: "p", severity: "high", onCommit: () => {} });
    engine.propose({ intent: "q", description: "q", grace: 1000, onCommit: () => {} });
    const done = engine.propose({ intent: "r", description: "r", grace: 1000, onCommit: () => {} });
    done.controls.undo();

    const phases = engine.getActive().map((a) => a.phase);
    expect(phases).toEqual(["proposed", "pending"]);
  });

  it("notifies subscribers on every transition and supports unsubscribe", () => {
    const engine = createEngine();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);

    const { controls } = engine.propose({
      intent: "a",
      description: "a",
      grace: 1000,
      onCommit: () => {},
    });
    expect(listener).toHaveBeenCalled();

    const before = listener.mock.calls.length;
    controls.undo();
    expect(listener.mock.calls.length).toBeGreaterThan(before);

    unsubscribe();
    const after = listener.mock.calls.length;
    engine.propose({ intent: "b", description: "b", grace: 1000, onCommit: () => {} });
    expect(listener.mock.calls.length).toBe(after);
  });

  it("prune drops finished actions", () => {
    const engine = createEngine();
    const { id, controls } = engine.propose({
      intent: "a",
      description: "a",
      grace: 1000,
      onCommit: () => {},
    });
    controls.undo();
    expect(engine.getAction(id)).toBeDefined();
    engine.prune();
    expect(engine.getAction(id)).toBeUndefined();
  });
});

describe("edges", () => {
  it("handles multiple concurrent actions independently", () => {
    const engine = createEngine();
    const commits: string[] = [];
    engine.propose({
      intent: "fast",
      description: "fast",
      grace: 1000,
      onCommit: (a) => {
        commits.push(a.intent);
      },
    });
    const slow = engine.propose({
      intent: "slow",
      description: "slow",
      grace: 5000,
      onCommit: (a) => {
        commits.push(a.intent);
      },
    });

    engine.advance(1000);
    expect(commits).toEqual(["fast"]);
    expect(engine.getAction(slow.id)?.phase).toBe("pending");
    engine.advance(4000);
    expect(commits).toEqual(["fast", "slow"]);
  });

  it("a rejected async onCommit does not break the queue", async () => {
    const errors: unknown[] = [];
    const engine = createEngine({ onCommitError: (error) => errors.push(error) });
    const onCommit = vi.fn();
    engine.propose({
      intent: "boom",
      description: "boom",
      grace: 100,
      onCommit: async () => {
        throw new Error("network down");
      },
    });
    engine.propose({ intent: "ok", description: "ok", grace: 200, onCommit });

    engine.advance(100);
    await Promise.resolve();
    expect(errors).toHaveLength(1);

    engine.advance(100);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("a throwing sync onCommit does not break the queue", () => {
    const errors: unknown[] = [];
    const engine = createEngine({ onCommitError: (error) => errors.push(error) });
    const first = engine.propose({
      intent: "boom",
      description: "boom",
      grace: 100,
      onCommit: () => {
        throw new Error("nope");
      },
    });
    engine.advance(100);
    expect(errors).toHaveLength(1);
    expect(engine.getAction(first.id)?.phase).toBe("committed");
  });

  it("a zero grace window commits immediately", () => {
    const engine = createEngine();
    const onCommit = vi.fn();
    const { id } = engine.propose({ intent: "a", description: "a", grace: 0, onCommit });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(engine.getAction(id)?.phase).toBe("committed");
  });

  it("dispose stops without committing pending actions", () => {
    const engine = createEngine();
    const onCommit = vi.fn();
    engine.propose({ intent: "a", description: "a", grace: 1000, onCommit });
    engine.dispose();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
