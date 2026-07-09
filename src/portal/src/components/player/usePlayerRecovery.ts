import { useRef, useCallback } from "react";

export function usePlayerRecovery() {
  const lastRecoveryAtRef = useRef(0);
  const recoveryWindowStartedAtRef = useRef(0);
  const recoveryAttemptsInWindowRef = useRef(0);

  const resetRecoveryWindow = useCallback(() => {
    recoveryWindowStartedAtRef.current = 0;
    recoveryAttemptsInWindowRef.current = 0;
  }, []);

  const attemptRecovery = useCallback((now: number = Date.now()) => {
    if (now - lastRecoveryAtRef.current < 2500) {
      return false;
    }

    if (
      recoveryWindowStartedAtRef.current <= 0 ||
      now - recoveryWindowStartedAtRef.current > 120_000
    ) {
      recoveryWindowStartedAtRef.current = now;
      recoveryAttemptsInWindowRef.current = 0;
    }

    if (recoveryAttemptsInWindowRef.current >= 6) {
      return false;
    }

    recoveryAttemptsInWindowRef.current += 1;
    lastRecoveryAtRef.current = now;
    return true;
  }, []);

  return {
    resetRecoveryWindow,
    attemptRecovery,
  };
}
