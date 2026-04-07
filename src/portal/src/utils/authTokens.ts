import { safeStorageGet, safeStorageSet } from "../../../shared/utils/storage";

const STANDALONE_TOKEN_KEY = "nsv_token";
const REMOTE_SERVER_TOKEN_KEY = "nsv_server_token";
const DEVICE_ID_KEY = "nsv_device_id";

type TokenKey = typeof STANDALONE_TOKEN_KEY | typeof REMOTE_SERVER_TOKEN_KEY;
export type AuthTarget = "local" | "remote";

type SecureStorageFacade = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const tokenCache: Record<TokenKey, string | null> = {
  [STANDALONE_TOKEN_KEY]: null,
  [REMOTE_SERVER_TOKEN_KEY]: null,
};

let secureStoragePromise: Promise<SecureStorageFacade | null> | null = null;
let secureStorageWarningShown = false;

function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

function normalizeToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim();
  return trimmed || null;
}

function getLegacyStandaloneToken(): string | null {
  return normalizeToken(
    safeStorageGet(sessionStorage, STANDALONE_TOKEN_KEY) ||
      safeStorageGet(localStorage, STANDALONE_TOKEN_KEY),
  );
}

function getLegacyRemoteServerToken(): string | null {
  return normalizeToken(safeStorageGet(localStorage, REMOTE_SERVER_TOKEN_KEY));
}

function removeLegacyTokenCopies(): void {
  try {
    sessionStorage.removeItem(STANDALONE_TOKEN_KEY);
  } catch {
    // Ignore storage access failures.
  }
  try {
    localStorage.removeItem(STANDALONE_TOKEN_KEY);
  } catch {
    // Ignore storage access failures.
  }
  try {
    localStorage.removeItem(REMOTE_SERVER_TOKEN_KEY);
  } catch {
    // Ignore storage access failures.
  }
}

function logSecureStorageWarning(error: unknown): void {
  if (secureStorageWarningShown) {
    return;
  }
  secureStorageWarningShown = true;
  console.warn("[secure-storage] Falling back to web storage.", error);
}

async function getSecureStorage(): Promise<SecureStorageFacade | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  secureStoragePromise ??= import("tauri-plugin-secure-storage")
    .then((module) => module.secureStorage)
    .catch((error) => {
      logSecureStorageWarning(error);
      return null;
    });

  return secureStoragePromise;
}

function persistStandaloneTokenFallback(normalized: string | null): void {
  try {
    if (normalized) {
      safeStorageSet(sessionStorage, STANDALONE_TOKEN_KEY, normalized);
      safeStorageSet(localStorage, STANDALONE_TOKEN_KEY, normalized);
    } else {
      sessionStorage.removeItem(STANDALONE_TOKEN_KEY);
      localStorage.removeItem(STANDALONE_TOKEN_KEY);
    }
  } catch {
    // Ignore storage access failures.
  }
}

function persistRemoteServerTokenFallback(normalized: string | null): void {
  try {
    if (normalized) {
      safeStorageSet(localStorage, REMOTE_SERVER_TOKEN_KEY, normalized);
    } else {
      localStorage.removeItem(REMOTE_SERVER_TOKEN_KEY);
    }
  } catch {
    // Ignore storage access failures.
  }
}

async function persistToken(
  key: TokenKey,
  value: string | null,
): Promise<string | null> {
  const normalized = normalizeToken(value);
  tokenCache[key] = normalized;

  const secureStorage = await getSecureStorage();
  if (secureStorage) {
    try {
      if (normalized) {
        await secureStorage.setItem(key, normalized);
      } else {
        await secureStorage.removeItem(key);
      }
      removeLegacyTokenCopies();
      return normalized;
    } catch (error) {
      logSecureStorageWarning(error);
    }
  }

  // Browser fallback path when secure storage is unavailable.
  if (key === STANDALONE_TOKEN_KEY) {
    persistStandaloneTokenFallback(normalized);
  } else {
    persistRemoteServerTokenFallback(normalized);
  }

  return normalized;
}

export async function initializeSecureTokenStorage(): Promise<void> {
  const secureStorage = await getSecureStorage();
  const legacyStandalone = getLegacyStandaloneToken();
  const legacyRemote = getLegacyRemoteServerToken();

  if (!secureStorage) {
    tokenCache[STANDALONE_TOKEN_KEY] = legacyStandalone;
    tokenCache[REMOTE_SERVER_TOKEN_KEY] = legacyRemote;
    return;
  }

  try {
    const [storedStandalone, storedRemote] = await Promise.all([
      secureStorage.getItem(STANDALONE_TOKEN_KEY),
      secureStorage.getItem(REMOTE_SERVER_TOKEN_KEY),
    ]);

    const resolvedStandalone =
      normalizeToken(storedStandalone) || legacyStandalone;
    const resolvedRemote = normalizeToken(storedRemote) || legacyRemote;

    if (!storedStandalone && legacyStandalone) {
      await secureStorage.setItem(STANDALONE_TOKEN_KEY, legacyStandalone);
    }
    if (!storedRemote && legacyRemote) {
      await secureStorage.setItem(REMOTE_SERVER_TOKEN_KEY, legacyRemote);
    }

    tokenCache[STANDALONE_TOKEN_KEY] = resolvedStandalone;
    tokenCache[REMOTE_SERVER_TOKEN_KEY] = resolvedRemote;
    removeLegacyTokenCopies();
  } catch (error) {
    logSecureStorageWarning(error);
    tokenCache[STANDALONE_TOKEN_KEY] = legacyStandalone;
    tokenCache[REMOTE_SERVER_TOKEN_KEY] = legacyRemote;
  }
}

export async function setStandaloneToken(token: string | null): Promise<void> {
  await persistToken(STANDALONE_TOKEN_KEY, token);
}

export async function setRemoteServerToken(
  token: string | null,
): Promise<void> {
  await persistToken(REMOTE_SERVER_TOKEN_KEY, token);
}

export function getStandaloneToken(): string | null {
  return tokenCache[STANDALONE_TOKEN_KEY] ?? getLegacyStandaloneToken();
}

export function getRemoteServerToken(): string | null {
  return tokenCache[REMOTE_SERVER_TOKEN_KEY] ?? getLegacyRemoteServerToken();
}

export function getActiveToken(target: AuthTarget): string | null {
  const standalone = getStandaloneToken();
  if (target === "remote") {
    return getRemoteServerToken() || standalone;
  }
  return standalone;
}

export function getDeviceId(): string | null {
  return normalizeToken(safeStorageGet(localStorage, DEVICE_ID_KEY));
}

export function buildAuthQuery(target: AuthTarget = "local"): string {
  const query = new URLSearchParams();
  const token = getActiveToken(target);
  const deviceId = getDeviceId();

  if (token) {
    query.set("t", token);
  }
  if (deviceId) {
    query.set("d", deviceId);
  }

  return query.toString();
}

export function buildAuthSuffix(target: AuthTarget = "local"): string {
  const query = buildAuthQuery(target);
  return query ? `?${query}` : "";
}
