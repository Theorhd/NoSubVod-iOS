import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import { safeStorageGet, safeStorageSet } from "../../shared/utils/storage";
import { getRemoteServerToken, setRemoteServerToken } from "./utils/authTokens";
import { useInterval } from "../../shared/hooks/useInterval";

const RELAY_STORAGE_KEY = "nsv_remote_relay_origin";

interface ServerContextState {
  isOnline: boolean;
  isConnected: boolean;
  token: string | null;
  serverUrl: string;
  setToken: (token: string) => void;
  setServerUrl: (url: string) => void;
  removeToken: () => void;
}

const ServerContext = createContext<ServerContextState | undefined>(undefined);

export function ServerProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [isOnline, setIsOnline] = useState(false);
  const [tokenValue, setTokenValue] = useState<string | null>(() => {
    return getRemoteServerToken();
  });
  const [serverUrlState, setServerUrlState] = useState<string>(() => {
    return (
      safeStorageGet(localStorage, "nsv_server_url") ||
      (import.meta as any).env.VITE_SERVER_URL ||
      ""
    );
  });

  const setToken = (newToken: string) => {
    setTokenValue(newToken);
    void setRemoteServerToken(newToken);
  };

  const removeToken = () => {
    setTokenValue(null);
    void setRemoteServerToken(null);
  };

  const setServerUrl = (url: string) => {
    const normalized = url.trim().replace(/\/$/, "");
    safeStorageSet(localStorage, "nsv_server_url", normalized);
    if (normalized) {
      safeStorageSet(localStorage, RELAY_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(RELAY_STORAGE_KEY);
    }
    setServerUrlState(normalized);
  };

  const checkStatus = useCallback(async () => {
    if (!serverUrlState || !tokenValue) {
      setIsOnline(false);
      return;
    }

    try {
      // Pinging the health endpoint to check if the server is available
      await fetch(`${serverUrlState}/api/auth/twitch/status`, {
        method: "GET",
        headers: tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {},
      });
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
  }, [serverUrlState, tokenValue]);

  useInterval(checkStatus, 30000);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkStatus();
  }, [checkStatus]);

  const value = useMemo(
    () => ({
      isOnline,
      isConnected: !!tokenValue && !!serverUrlState,
      token: tokenValue,
      serverUrl: serverUrlState,
      setToken,
      setServerUrl,
      removeToken,
    }),
    [isOnline, tokenValue, serverUrlState],
  );

  return (
    <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
  );
}

export function useServer() {
  const context = useContext(ServerContext);
  if (context === undefined) {
    throw new Error("useServer must be used within a ServerProvider");
  }
  return context;
}
