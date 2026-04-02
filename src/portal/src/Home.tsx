import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExperienceSettings,
  HistoryVodEntry,
  LiveStatusMap,
  SubEntry,
  UserInfo,
  WatchlistEntry,
} from '../../shared/types';
import ChannelSearchCard from './components/home/ChannelSearchCard';
import MySubsList from './components/home/MySubsList';
import HistoryPreview from './components/home/HistoryPreview';
import WatchlistPreview from './components/home/WatchlistPreview';
import { TopBar } from './components/TopBar';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
};

export default function Home() {
  const navigate = useNavigate();
  const [subs, setSubs] = useState<SubEntry[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [historyPreview, setHistoryPreview] = useState<HistoryVodEntry[]>([]);
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [liveStatus, setLiveStatus] = useState<LiveStatusMap>({});

  const [showModal, setShowModal] = useState(false);
  const [streamerInput, setStreamerInput] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSearchingStreamer, setIsSearchingStreamer] = useState(false);

  const [channelSearch, setChannelSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserInfo[]>([]);
  const [isSearchingChannels, setIsSearchingChannels] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [watchlistRes, settingsRes, historyRes] = await Promise.all([
          fetch('/api/watchlist'),
          fetch('/api/settings'),
          fetch('/api/history/list?limit=3'),
        ]);

        if (watchlistRes.ok) {
          setWatchlist((await watchlistRes.json()) as WatchlistEntry[]);
        }

        if (historyRes.ok) {
          setHistoryPreview((await historyRes.json()) as HistoryVodEntry[]);
        }

        let oneSyncEnabled = false;
        if (settingsRes.ok) {
          const remoteSettings = (await settingsRes.json()) as ExperienceSettings;
          oneSyncEnabled = Boolean(remoteSettings.oneSync);
          setSettings({ oneSync: oneSyncEnabled });
        }

        if (oneSyncEnabled) {
          const subsRes = await fetch('/api/subs');
          if (subsRes.ok) {
            setSubs((await subsRes.json()) as SubEntry[]);
          }
        } else {
          const saved = localStorage.getItem('nsv_subs');
          setSubs(saved ? (JSON.parse(saved) as SubEntry[]) : []);
        }
      } catch (error) {
        console.error('Failed to fetch initial home data', error);
      }
    };

    void loadData();
  }, []);

  useEffect(() => {
    const loadLiveStatus = async () => {
      if (subs.length === 0) {
        setLiveStatus({});
        return;
      }

      try {
        const logins = subs.map((sub) => sub.login.toLowerCase()).join(',');
        const res = await fetch(`/api/live/status?logins=${encodeURIComponent(logins)}`);
        if (!res.ok) {
          setLiveStatus({});
          return;
        }

        setLiveStatus((await res.json()) as LiveStatusMap);
      } catch (error) {
        console.error('Failed to fetch live status for subs', error);
        setLiveStatus({});
      }
    };

    void loadLiveStatus();
  }, [subs]);

  const saveSubsLocal = (newSubs: SubEntry[]) => {
    setSubs(newSubs);
    localStorage.setItem('nsv_subs', JSON.stringify(newSubs));
  };

  const saveSubServer = async (entry: SubEntry) => {
    const res = await fetch('/api/subs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });

    if (res.ok) {
      setSubs((prev) => {
        if (prev.some((s) => s.login === entry.login)) return prev;
        return [...prev, entry];
      });
    }
  };

  const removeSubServer = async (login: string) => {
    const res = await fetch(`/api/subs/${encodeURIComponent(login)}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      setSubs((prev) => prev.filter((s) => s.login !== login));
    }
  };

  const removeFromWatchlist = async (vodId: string) => {
    try {
      const res = await fetch(`/api/watchlist/${vodId}`, { method: 'DELETE' });
      if (res.ok) {
        setWatchlist((prev) => prev.filter((w) => w.vodId !== vodId));
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleChannelSearch = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const query = channelSearch.trim();
    if (!query) return;

    setIsSearchingChannels(true);
    try {
      const res = await fetch(`/api/search/channels?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Failed to search channels');
      const data = (await res.json()) as UserInfo[];
      setSearchResults(data);
    } catch (error) {
      console.error(error);
      setSearchResults([]);
    } finally {
      setIsSearchingChannels(false);
    }
  };

  const handleAddSub = async () => {
    const username = streamerInput.trim().toLowerCase();
    if (!username) return;

    if (subs.some((sub) => sub.login === username)) {
      setModalError('Already subbed to this user.');
      return;
    }

    setIsSearchingStreamer(true);
    setModalError('');

    try {
      const res = await fetch(`/api/user/${username}`);
      if (!res.ok) throw new Error('User not found');
      const user = (await res.json()) as UserInfo;

      const newSub: SubEntry = {
        login: user.login,
        displayName: user.displayName,
        profileImageURL: user.profileImageURL,
      };

      if (settings.oneSync) {
        await saveSubServer(newSub);
      } else {
        saveSubsLocal([...subs, newSub]);
      }

      setShowModal(false);
      setStreamerInput('');
    } catch (error: any) {
      setModalError(error?.message || 'Error finding user.');
    } finally {
      setIsSearchingStreamer(false);
    }
  };

  const handleDeleteSub = async (e: React.MouseEvent, login: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!globalThis.confirm('Remove this streamer?')) {
      return;
    }

    if (settings.oneSync) {
      await removeSubServer(login);
      return;
    }

    saveSubsLocal(subs.filter((sub) => sub.login !== login));
  };

  return (
    <>
      <TopBar
        mode="logo"
        title="NoSubVod"
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="action-btn"
              style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%' }}
              onClick={() => setShowModal(true)}
              aria-label="Add sub"
              type="button"
            >
              +
            </button>
            <button
              className="secondary-btn"
              style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%' }}
              onClick={() => navigate('/settings')}
              aria-label="Open settings"
              title="Settings"
              type="button"
            >
              ⚙
            </button>
          </div>
        }
      />

      <div className="container">
        <ChannelSearchCard
          channelSearch={channelSearch}
          setChannelSearch={setChannelSearch}
          isSearchingChannels={isSearchingChannels}
          searchResults={searchResults}
          handleChannelSearch={handleChannelSearch}
        />

        <MySubsList subs={subs} liveStatus={liveStatus} handleDeleteSub={handleDeleteSub} />

        <HistoryPreview historyPreview={historyPreview} />

        <WatchlistPreview watchlist={watchlist} removeFromWatchlist={removeFromWatchlist} />
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Sub to a Streamer</h3>
            <label htmlFor="streamerInput">Twitch Username</label>
            <input
              type="text"
              id="streamerInput"
              placeholder="e.g. zerator"
              value={streamerInput}
              onChange={(e) => setStreamerInput(e.target.value)}
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleAddSub();
                }
              }}
            />
            {modalError && <div className="error-text">{modalError}</div>}
            <div className="btn-row">
              <button
                className="action-btn cancel"
                onClick={() => setShowModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="action-btn"
                onClick={() => void handleAddSub()}
                disabled={isSearchingStreamer}
                type="button"
              >
                {isSearchingStreamer ? 'Searching...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
