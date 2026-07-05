import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "../../../shared/types";

const CHAT_REPLAY_VISIBLE_MESSAGES = 170;
const CHAT_REPLAY_FUTURE_TOLERANCE_SECONDS = 0.35;
const CHAT_REPLAY_SEEK_RESET_SECONDS = 2;
const MAX_CHAT_MESSAGES = 700;
const CHAT_HISTORY_SECONDS = 10 * 60;

export function useChatReplay(
  vodId: string | null,
  liveId: string | null,
  showChat: boolean,
  isFullscreen: boolean,
  currentTime: number,
  currentTimeRef: React.MutableRefObject<number>,
) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const lastChatOffsetRef = useRef(-1);
  const pendingChatOffsetsRef = useRef(new Set<number>());
  const dispatchedChatIds = useRef(new Set<string>());
  const lastRequestedOffsetRef = useRef(-1);

  const shouldLoadChat = Boolean(vodId && showChat && !isFullscreen);

  const replayChatMessages = useMemo(() => {
    if (!shouldLoadChat) return [];
    if (chatMessages.length === 0) return [];

    const firstFutureIndex = chatMessages.findIndex(
      (m) =>
        m.contentOffsetSeconds >
        currentTime + CHAT_REPLAY_FUTURE_TOLERANCE_SECONDS,
    );
    const replayEndIndex =
      firstFutureIndex === -1 ? chatMessages.length : firstFutureIndex;
    const replayStartIndex = Math.max(
      0,
      replayEndIndex - CHAT_REPLAY_VISIBLE_MESSAGES,
    );

    return chatMessages.slice(replayStartIndex, replayEndIndex);
  }, [chatMessages, currentTime, shouldLoadChat]);

  useEffect(() => {
    if (liveId || !shouldLoadChat) return;
    for (const msg of replayChatMessages) {
      if (!dispatchedChatIds.current.has(msg.id)) {
        dispatchedChatIds.current.add(msg.id);
        globalThis.dispatchEvent(
          new CustomEvent("nsv-chat-message", { detail: msg }),
        );
      }
    }
    // Bound memory without clearing everything
    const MAX_DISPATCHED_IDS = 2500;
    const TRIM_TO = 1800;
    if (dispatchedChatIds.current.size > MAX_DISPATCHED_IDS) {
      const toDrop = dispatchedChatIds.current.size - TRIM_TO;
      let dropped = 0;
      for (const id of dispatchedChatIds.current) {
        dispatchedChatIds.current.delete(id);
        dropped += 1;
        if (dropped >= toDrop) break;
      }
    }
  }, [replayChatMessages, liveId, shouldLoadChat]);

  const fetchVodChatChunk = useCallback(
    async (offset: number) => {
      if (!vodId) return;
      if (offset === lastChatOffsetRef.current) return;
      if (pendingChatOffsetsRef.current.has(offset)) return;

      pendingChatOffsetsRef.current.add(offset);

      try {
        const res = await fetch(
          `/api/vod/${vodId}/chat?offset=${offset}&limit=100`,
        );
        if (!res.ok) return;

        const data = await res.json();
        setChatMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const incoming = (data.messages || []).filter(
            (m: ChatMessage) => !known.has(m.id),
          );
          if (incoming.length === 0) return prev;

          const merged = [...prev, ...incoming].sort(
            (a, b) => a.contentOffsetSeconds - b.contentOffsetSeconds,
          );

          const now = currentTimeRef.current || 0;
          const cutoff = Math.max(0, now - CHAT_HISTORY_SECONDS);
          const recent = merged.filter(
            (message) => message.contentOffsetSeconds >= cutoff,
          );

          if (recent.length <= MAX_CHAT_MESSAGES) return recent;
          return recent.slice(recent.length - MAX_CHAT_MESSAGES);
        });

        lastChatOffsetRef.current = offset;
      } catch (error) {
        console.error("Failed to fetch chat", error);
      } finally {
        pendingChatOffsetsRef.current.delete(offset);
      }
    },
    [vodId, currentTimeRef],
  );

  const resetChatState = useCallback(() => {
    setChatMessages([]);
    lastChatOffsetRef.current = -1;
    lastRequestedOffsetRef.current = -1;
    pendingChatOffsetsRef.current.clear();
    dispatchedChatIds.current.clear();
  }, []);

  const handleTimeUpdateForChat = useCallback(
    (time: number, previousTime: number) => {
      if (
        shouldLoadChat &&
        Math.abs(time - previousTime) >= CHAT_REPLAY_SEEK_RESET_SECONDS
      ) {
        dispatchedChatIds.current.clear();
      }

      if (!shouldLoadChat) return;
      const offset = Math.floor(time / 60) * 60;
      if (offset === lastRequestedOffsetRef.current) return;
      lastRequestedOffsetRef.current = offset;
      void fetchVodChatChunk(offset);
    },
    [fetchVodChatChunk, shouldLoadChat],
  );

  useEffect(() => {
    if (shouldLoadChat) {
      lastRequestedOffsetRef.current = -1;
      lastChatOffsetRef.current = -1;
      const offset = Math.floor((currentTimeRef.current || 0) / 60) * 60;
      void fetchVodChatChunk(offset);
      return;
    }

    pendingChatOffsetsRef.current.clear();
    dispatchedChatIds.current.clear();
    setChatMessages((prev) => {
      if (prev.length <= 120) return prev;
      return prev.slice(prev.length - 120);
    });
  }, [fetchVodChatChunk, shouldLoadChat, currentTimeRef]);

  return {
    shouldLoadChat,
    replayChatMessages,
    setChatMessages,
    resetChatState,
    handleTimeUpdateForChat,
  };
}
