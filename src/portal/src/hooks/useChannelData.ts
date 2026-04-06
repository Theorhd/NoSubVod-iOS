import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  HistoryEntry,
  LiveStream,
  LiveStreamsPage,
  VOD,
} from "../../../shared/types";
import { usePageVisibility } from "../../../shared/hooks/usePageVisibility";

type CategoryVodPage = {
  items: VOD[];
  hasMore: boolean;
  nextCursor: string | null;
};

const MIN_VOD_DURATION_SECONDS = 210;
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;

  const relayAbort = () => {
    controller.abort();
  };

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", relayAbort, { once: true });
    }
  }

  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", relayAbort);
    }
  }
}

const filterShortVods = (vods: VOD[]): VOD[] =>
  vods.filter((vod) => (vod.lengthSeconds || 0) >= MIN_VOD_DURATION_SECONDS);

type UseChannelDataParams = Readonly<{
  user: string | null;
  category: string | null;
  categoryId: string | null;
  refreshKey?: string;
}>;

export function useChannelData({
  user,
  category,
  categoryId,
  refreshKey,
}: UseChannelDataParams) {
  const [vods, setVods] = useState<VOD[]>([]);
  const [liveStream, setLiveStream] = useState<LiveStream | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [catLiveStreams, setCatLiveStreams] = useState<LiveStream[]>([]);
  const [catLiveCursor, setCatLiveCursor] = useState<string | null>(null);
  const [catLiveHasMore, setCatLiveHasMore] = useState(false);
  const [catLiveLoading, setCatLiveLoading] = useState(false);
  const [catVodCursor, setCatVodCursor] = useState<string | null>(null);
  const [catVodHasMore, setCatVodHasMore] = useState(false);
  const [catVodLoading, setCatVodLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isPageVisible = usePageVisibility();

  const isUserMode = Boolean(user);
  const isCategoryMode = !isUserMode && Boolean(category);

  const title = useMemo(() => {
    if (category) return category;
    if (user) return user;
    return "VODs";
  }, [category, user]);

  const fetchHistory = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetchWithTimeout("/api/history", { signal });
      return res.ok ? ((await res.json()) as Record<string, HistoryEntry>) : {};
    } catch {
      return {};
    }
  }, []);

  const fetchUserData = useCallback(
    async (targetUser: string, signal: AbortSignal) => {
      const [vodsData, liveData, historyData] = await Promise.all([
        fetchWithTimeout(`/api/user/${encodeURIComponent(targetUser)}/vods`, {
          signal,
        }).then((res) => {
          if (!res.ok) throw new Error("Failed to fetch VODs");
          return res.json() as Promise<VOD[]>;
        }),
        fetchWithTimeout(`/api/user/${encodeURIComponent(targetUser)}/live`, {
          signal,
        })
          .then((res) => (res.ok ? (res.json() as Promise<LiveStream>) : null))
          .catch(() => null),
        fetchHistory(signal),
      ]);

      if (signal.aborted) return;

      setVods(filterShortVods(vodsData));
      setLiveStream(liveData);
      setHistory(historyData);
      setCatLiveStreams([]);
      setCatLiveCursor(null);
      setCatLiveHasMore(false);
      setCatVodCursor(null);
      setCatVodHasMore(false);
    },
    [fetchHistory],
  );

  const fetchCategoryData = useCallback(
    async (targetCategory: string, signal: AbortSignal) => {
      const categoryVodParams = new URLSearchParams({
        name: targetCategory,
        limit: "24",
      });
      if (categoryId) categoryVodParams.set("id", categoryId);

      const [vodPage, livePage, historyData] = await Promise.all([
        fetchWithTimeout(
          `/api/search/category-vods?${categoryVodParams.toString()}`,
          {
            signal,
          },
        ).then((res) => {
          if (!res.ok) throw new Error("Failed to fetch VODs");
          return res.json() as Promise<CategoryVodPage>;
        }),
        fetchWithTimeout(
          `/api/live/category?name=${encodeURIComponent(targetCategory)}&limit=12`,
          { signal },
        )
          .then((res) =>
            res.ok ? (res.json() as Promise<LiveStreamsPage>) : null,
          )
          .catch(() => null),
        fetchHistory(signal),
      ]);

      if (signal.aborted) return;

      setVods(filterShortVods(vodPage.items || []));
      setCatVodCursor(vodPage.nextCursor || null);
      setCatVodHasMore(Boolean(vodPage.hasMore));
      setCatLiveStreams(livePage?.items || []);
      setCatLiveCursor(livePage?.nextCursor || null);
      setCatLiveHasMore(Boolean(livePage?.hasMore));
      setLiveStream(null);
      setHistory(historyData);
    },
    [categoryId, fetchHistory],
  );

  const fetchData = useCallback(async () => {
    if (!isUserMode && !isCategoryMode) {
      setError("No channel or category specified");
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setError("");

    try {
      if (isUserMode && user) {
        await fetchUserData(user, signal);
      } else if (isCategoryMode && category) {
        await fetchCategoryData(category, signal);
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "An unknown error occurred");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [
    category,
    fetchCategoryData,
    fetchUserData,
    isCategoryMode,
    isUserMode,
    user,
  ]);

  useEffect(() => {
    if (!isPageVisible) {
      return;
    }

    void fetchData();

    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchData, isPageVisible, refreshKey]);

  const loadMoreCatVods = useCallback(async () => {
    if (!category || catVodLoading || !catVodHasMore) return;
    setCatVodLoading(true);
    try {
      const params = new URLSearchParams({ name: category, limit: "24" });
      if (categoryId) params.set("id", categoryId);
      if (catVodCursor) params.set("cursor", catVodCursor);
      const res = await fetchWithTimeout(
        `/api/search/category-vods?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to load more VODs");
      const page = (await res.json()) as CategoryVodPage;
      if (page.items && page.items.length > 0) {
        setVods((prev) => {
          const existingIds = new Set(prev.map((v) => v.id));
          return [
            ...prev,
            ...filterShortVods(page.items).filter(
              (v) => !existingIds.has(v.id),
            ),
          ];
        });
      }
      setCatVodCursor(page.nextCursor || null);
      setCatVodHasMore(Boolean(page.hasMore));
    } catch {
      // ignore load-more transient failures
    } finally {
      setCatVodLoading(false);
    }
  }, [catVodCursor, catVodHasMore, catVodLoading, category, categoryId]);

  const loadMoreCatLive = useCallback(async () => {
    if (!category || catLiveLoading || !catLiveHasMore) return;
    setCatLiveLoading(true);
    try {
      const params = new URLSearchParams({ name: category, limit: "12" });
      if (catLiveCursor) params.set("cursor", catLiveCursor);
      const res = await fetchWithTimeout(
        `/api/live/category?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to load more lives");
      const page = (await res.json()) as LiveStreamsPage;
      if (page.items && page.items.length > 0) {
        setCatLiveStreams((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          return [...prev, ...page.items.filter((s) => !existingIds.has(s.id))];
        });
      }
      setCatLiveCursor(page.nextCursor || null);
      setCatLiveHasMore(Boolean(page.hasMore));
    } catch {
      // ignore load-more transient failures
    } finally {
      setCatLiveLoading(false);
    }
  }, [catLiveCursor, catLiveHasMore, catLiveLoading, category]);

  const addToWatchlist = useCallback(async (vod: VOD) => {
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodId: vod.id,
          title: vod.title,
          previewThumbnailURL: vod.previewThumbnailURL,
          lengthSeconds: vod.lengthSeconds,
        }),
      });
    } catch {
      // ignore watchlist failures
    }
  }, []);

  return {
    title,
    isUserMode,
    isCategoryMode,
    vods,
    liveStream,
    history,
    loading,
    error,
    catLiveStreams,
    catLiveHasMore,
    catLiveLoading,
    catVodHasMore,
    catVodLoading,
    loadMoreCatVods,
    loadMoreCatLive,
    addToWatchlist,
  };
}
