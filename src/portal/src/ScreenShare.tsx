import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from './components/TopBar';

const RELAY_STORAGE_KEY = 'nsv_remote_relay_origin';

function normalizeRelayOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  return parsed.origin;
}

export default function ScreenShare() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState('');
  const [relayOrigin, setRelayOrigin] = useState(() => {
    const existing = globalThis.localStorage.getItem(RELAY_STORAGE_KEY);
    return existing || '';
  });

  const [relayError, setRelayError] = useState('');

  const viewerUrl = useMemo(() => {
    const id = sessionId.trim();
    const relay = relayOrigin.trim();
    const query = new URLSearchParams({ screenshare: '1' });
    if (id) query.set('sessionId', id);
    if (relay) query.set('relay', relay);
    return `/player?${query.toString()}`;
  }, [sessionId, relayOrigin]);

  const openViewer = () => {
    try {
      const normalized = normalizeRelayOrigin(relayOrigin);
      if (!normalized) {
        setRelayError('Relay URL is required to connect to NSV-Desktop.');
        return;
      }
      globalThis.localStorage.setItem(RELAY_STORAGE_KEY, normalized);
      setRelayError('');
      navigate(viewerUrl);
    } catch {
      setRelayError('Invalid relay URL. Example: https://192.168.1.10:23456');
    }
  };

  return (
    <>
      <TopBar mode="logo" title="Screen Share" onLogoClick={() => navigate('/')} />
      <div className="container">
        <div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
          <h2 style={{ marginTop: 0 }}>Join Screen Share (Viewer)</h2>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>
            iOS can receive NSV-Desktop screen shares but cannot broadcast its own screen.
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Enter a remote session ID if your NSV-Desktop host gave you one. You can also continue
            without it and connect to the active host session.
          </p>

          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              NSV-Desktop Relay URL
            </label>
            <input
              type="text"
              value={relayOrigin}
              onChange={(event) => setRelayOrigin(event.target.value)}
              className="search-input"
              placeholder="https://192.168.1.10:23456"
            />

            <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Session ID</label>
            <input
              type="text"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              className="search-input"
              placeholder="Optional: paste session id"
            />
          </div>

          {relayError && (
            <p style={{ marginTop: 10, color: '#f87171', fontSize: '0.9rem' }}>{relayError}</p>
          )}

          <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="action-btn" onClick={openViewer}>
              Open Viewer
            </button>
            <button className="secondary-btn" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
