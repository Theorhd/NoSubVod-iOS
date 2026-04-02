import React, { useCallback, useEffect, useState } from 'react';

interface LiveChatComponentProps {
  liveId: string;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
}

type LiveChatMessage = {
  id?: string;
  type?: string;
  displayName?: string;
  color?: string;
  message?: string;
};

type LiveChatBatch = {
  type?: string;
  messages?: LiveChatMessage[];
};

const MAX_LIVE_CHAT_MESSAGES = 300;

function isTauriRuntime(): boolean {
  return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

async function invokeTauri<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, payload);
}

function buildAuthQueryFromStorage(): string {
  const token = localStorage.getItem('nsv_token');
  const deviceId = localStorage.getItem('nsv_device_id');
  const parts: string[] = [];

  if (token) {
    parts.push(`t=${encodeURIComponent(token)}`);
  }
  if (deviceId) {
    parts.push(`d=${encodeURIComponent(deviceId)}`);
  }

  return parts.join('&');
}

const LiveChatComponent: React.FC<LiveChatComponentProps> = ({ liveId, chatScrollRef }) => {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [twitchLinked, setTwitchLinked] = useState(false);
  const [twitchDisplayName, setTwitchDisplayName] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [connectionLabel, setConnectionLabel] = useState('Connected');
  const pollingSessionIdRef = React.useRef<string | null>(null);

  const tauriRuntime = isTauriRuntime();

  useEffect(() => {
    fetch('/api/auth/twitch/status')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.linked) {
          setTwitchLinked(true);
          setTwitchDisplayName(data.userDisplayName || data.userLogin || '');
        }
      })
      .catch(() => {
        // Ignore status polling failure here.
      });
  }, []);

  const applyIncomingMessages = useCallback(
    (incoming: LiveChatMessage[]) => {
      setMessages((prev) => {
        let next = prev;
        for (const data of incoming) {
          if (data.type === 'clear_chat') {
            next = [];
            continue;
          }

          if (data.type === 'clear_msg' && data.id) {
            next = next.filter((msg) => msg.id !== data.id);
            continue;
          }

          if (!data.id) {
            continue;
          }

          next = [...next, data];
          globalThis.dispatchEvent(new CustomEvent('nsv-chat-message', { detail: data }));
        }

        if (next.length > MAX_LIVE_CHAT_MESSAGES) {
          return next.slice(-MAX_LIVE_CHAT_MESSAGES);
        }
        return next;
      });

      const container = chatScrollRef.current;
      if (!container) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 150) {
        globalThis.setTimeout(() => {
          if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
          }
        }, 50);
      }
    },
    [chatScrollRef]
  );

  const sendMessage = async () => {
    const message = chatInput.trim();
    if (!message || sending) return;

    setSending(true);
    setSendError('');
    try {
      const response = await fetch(`/api/live/${encodeURIComponent(liveId)}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (response.ok) {
        setChatInput('');
      } else {
        const payload = await response.json().catch(() => null);
        setSendError(payload?.error || 'Message send failed.');
      }
    } catch (error) {
      console.error('Failed to send chat message', error);
      setSendError('Network error while sending message.');
    } finally {
      setSending(false);
    }
  };

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as LiveChatMessage | LiveChatBatch;
        const maybeBatch = payload as LiveChatBatch;
        const incoming =
          payload?.type === 'batch' && Array.isArray(maybeBatch.messages)
            ? maybeBatch.messages
            : [payload as LiveChatMessage];
        applyIncomingMessages(incoming);
      } catch (error) {
        console.error('Failed to parse chat message', error);
      }
    },
    [applyIncomingMessages]
  );

  useEffect(() => {
    if (tauriRuntime) {
      setConnectionLabel('Connecting...');

      let disposed = false;
      let pollTimer: ReturnType<typeof setInterval> | undefined;

      const connectPolling = async () => {
        try {
          const sessionId = await invokeTauri<string>('start_live_chat_polling', { liveId });
          if (disposed) {
            await invokeTauri('stop_live_chat_polling', { sessionId }).catch(() => undefined);
            return;
          }

          pollingSessionIdRef.current = sessionId;
          setConnectionLabel('Connected');

          const poll = async () => {
            const currentSession = pollingSessionIdRef.current;
            if (!currentSession) return;
            try {
              const payload = await invokeTauri<LiveChatBatch>('poll_live_chat', {
                sessionId: currentSession,
              });
              const incoming = Array.isArray(payload?.messages) ? payload.messages : [];
              if (incoming.length > 0) {
                applyIncomingMessages(incoming);
              }
            } catch {
              setConnectionLabel('Reconnecting...');
            }
          };

          pollTimer = globalThis.setInterval(() => {
            void poll();
          }, 900);
        } catch (error) {
          console.error('Failed to start live chat polling', error);
          setConnectionLabel('Unavailable');
        }
      };

      void connectPolling();

      return () => {
        disposed = true;
        if (pollTimer) {
          globalThis.clearInterval(pollTimer);
        }
        const sessionId = pollingSessionIdRef.current;
        pollingSessionIdRef.current = null;
        if (sessionId) {
          void invokeTauri('stop_live_chat_polling', { sessionId });
        }
      };

      return;
    }

    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }

      const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = globalThis.location.host;
      const authQuery = buildAuthQueryFromStorage();
      const query = authQuery ? `?${authQuery}` : '';
      const wsUrl = `${protocol}//${host}/api/live/${encodeURIComponent(liveId)}/chat/ws${query}`;

      ws = new WebSocket(wsUrl);
      ws.onopen = () => setConnectionLabel('Connected');
      ws.onmessage = handleWsMessage;
      ws.onclose = () => {
        setConnectionLabel('Reconnecting...');
        if (!disposed) {
          reconnectTimeout = globalThis.setTimeout(connect, 3000);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      globalThis.clearTimeout(reconnectTimeout);
      if (ws) {
        ws.close();
      }
    };
  }, [liveId, handleWsMessage, tauriRuntime, applyIncomingMessages]);

  return (
    <>
      <div
        style={{
          padding: '15px',
          borderBottom: '1px solid #3a3a3d',
          fontWeight: 'bold',
          color: '#efeff1',
          fontSize: '0.9rem',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>LIVE CHAT</span>
        <span
          style={{
            fontSize: '0.75rem',
            color: connectionLabel === 'Connected' ? '#4ade80' : '#f59e0b',
          }}
        >
          {connectionLabel}
        </span>
      </div>

      <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {messages.map((message, index) => (
          <div
            key={message.id || index}
            style={{
              marginBottom: '8px',
              fontSize: '0.85rem',
              lineHeight: '1.4',
              wordWrap: 'break-word',
            }}
          >
            <span style={{ fontWeight: 'bold', color: message.color || '#bf94ff' }}>
              {message.displayName || 'Unknown'}:{' '}
            </span>
            <span style={{ color: '#efeff1' }}>{message.message || ''}</span>
          </div>
        ))}
      </div>

      {twitchLinked && (
        <div
          style={{
            padding: '8px',
            borderTop: '1px solid #3a3a3d',
            display: 'flex',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={chatInput}
            onChange={(event) => {
              setChatInput(event.target.value);
              if (sendError) {
                setSendError('');
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void sendMessage();
              }
            }}
            placeholder={`Message as ${twitchDisplayName}`}
            maxLength={500}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: '#1f1f23',
              border: '1px solid #3a3a3d',
              borderRadius: '4px',
              color: '#efeff1',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />

          <button
            onClick={() => {
              void sendMessage();
            }}
            disabled={!chatInput.trim() || sending}
            type="button"
            style={{
              padding: '6px 12px',
              background: '#9146ff',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.85rem',
              opacity: !chatInput.trim() || sending ? 0.5 : 1,
            }}
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      )}

      {sendError && (
        <div
          style={{
            padding: '8px 10px',
            color: '#f87171',
            fontSize: '0.8rem',
            borderTop: '1px solid #3a3a3d',
            background: '#140f12',
          }}
        >
          {sendError}
        </div>
      )}
    </>
  );
};

export default LiveChatComponent;
