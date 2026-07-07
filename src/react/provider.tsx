import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { ReversibleEngine } from "../core";

const ReversibleContext = createContext<ReversibleEngine | null>(null);

export interface ReversibleProviderProps {
  children?: ReactNode;
  /** Bring your own engine. The provider will not dispose engines it does not own. */
  engine?: ReversibleEngine;
  /** Default grace window in milliseconds for engines created by this provider. */
  defaultGrace?: number;
  /** Tick interval in milliseconds for engines created by this provider. */
  tickInterval?: number;
}

/**
 * Creates (or accepts) a ReversibleEngine and shares it via context.
 * Engines created here are disposed on unmount.
 */
export function ReversibleProvider({
  children,
  engine,
  defaultGrace,
  tickInterval,
}: ReversibleProviderProps) {
  const ownedRef = useRef<ReversibleEngine | null>(null);
  if (!engine && ownedRef.current === null) {
    ownedRef.current = new ReversibleEngine({ defaultGrace, tickInterval });
  }
  const value = engine ?? ownedRef.current!;

  useEffect(() => {
    return () => {
      ownedRef.current?.dispose();
    };
  }, []);

  return <ReversibleContext.Provider value={value}>{children}</ReversibleContext.Provider>;
}

/** The engine from the nearest ReversibleProvider. Throws outside of one. */
export function useReversibleEngine(): ReversibleEngine {
  const engine = useContext(ReversibleContext);
  if (!engine) {
    throw new Error("reversible: wrap your tree in <ReversibleProvider>");
  }
  return engine;
}
