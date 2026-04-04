import type { NavigateFunction } from "react-router-dom";

type HistoryStateWithIndex = {
  idx?: number;
};

export function navigateBackInApp(
  navigate: NavigateFunction,
  fallbackPath = "/",
) {
  const historyState = globalThis.history.state as HistoryStateWithIndex | null;
  const historyIndex =
    historyState && typeof historyState.idx === "number"
      ? historyState.idx
      : null;

  if (historyIndex !== null) {
    if (historyIndex > 0) {
      navigate(-1);
      return;
    }

    navigate(fallbackPath, { replace: true });
    return;
  }

  if (globalThis.history.length > 1) {
    navigate(-1);
    return;
  }

  navigate(fallbackPath, { replace: true });
}