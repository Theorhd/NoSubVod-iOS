import type { NavigateFunction } from "react-router-dom";

type HistoryStateWithIndex = {
  idx?: number;
};

type PlayerNavigationState = {
  from?: string;
};

type NavigateToPlayerOptions = {
  vodId?: string | null;
  liveId?: string | null;
  downloadMode?: boolean;
  fromPath?: string;
  replace?: boolean;
};

function getCurrentRoutePath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

function normalizeFromPath(fromPath?: string): string {
  if (typeof fromPath === "string" && fromPath.startsWith("/")) {
    return fromPath;
  }
  return getCurrentRoutePath();
}

function buildPlayerPath(options: NavigateToPlayerOptions): string {
  const params = new URLSearchParams();

  if (options.vodId) {
    params.set("vod", options.vodId);
  }
  if (options.liveId) {
    params.set("live", options.liveId);
  }
  if (options.downloadMode) {
    params.set("downloadMode", "true");
  }

  const query = params.toString();
  return query ? `/player?${query}` : "/player";
}

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

export function navigateToPlayer(
  navigate: NavigateFunction,
  options: NavigateToPlayerOptions,
) {
  const target = buildPlayerPath(options);
  const from = normalizeFromPath(options.fromPath);

  navigate(target, {
    replace: Boolean(options.replace),
    state: { from } as PlayerNavigationState,
  });
}
