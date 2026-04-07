import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { safeStorageGet, safeStorageSet } from "../../shared/utils/storage";
import {
  getActiveToken,
  getDeviceId,
  getRemoteServerToken,
  initializeSecureTokenStorage,
  setStandaloneToken,
} from "./utils/authTokens";

type InternalApiInvokeResponse = {
  status: number;
  body: string;
  is_base64?: boolean;
  content_type?: string | null;
};

const API_INVOKE_TIMEOUT_MS = 10000;
const API_RETRY_DELAY_MS = 250;
const API_MAX_IDEMPOTENT_RETRIES = 1;

const TWITCH_DEEP_LINK_PROTOCOL = "nosubvod:";
const TWITCH_DEEP_LINK_HOST = "auth";
const TWITCH_DEEP_LINK_PATH = "/twitch/callback";
const TWITCH_OAUTH_STATUS_STORAGE_KEY = "nsv_twitch_oauth_status";
const APP_READY_EVENT_NAME = "nsv-app-ready";
const LAUNCH_LOADER_ID = "nsv-launch-loader";
const LAUNCH_LOADER_HIDING_CLASS = "is-hiding";
const LAUNCH_LOADER_TRANSITION_MS = 760;
const LAUNCH_LOADER_FALLBACK_TIMEOUT_MS = 15000;

let hasDismissedLaunchLoader = false;

function dismissLaunchLoader(): void {
  if (hasDismissedLaunchLoader) {
    return;
  }

  hasDismissedLaunchLoader = true;
  const loader = document.getElementById(LAUNCH_LOADER_ID);
  if (!loader) {
    return;
  }

  const cleanup = () => {
    loader.remove();
  };

  loader.classList.add(LAUNCH_LOADER_HIDING_CLASS);
  loader.addEventListener("transitionend", cleanup, { once: true });
  globalThis.setTimeout(cleanup, LAUNCH_LOADER_TRANSITION_MS + 80);
}

type ApiInvokeCommand = "internal_api_request" | "proxy_remote_request";

class ApiInvokeTimeoutError extends Error {
  public readonly command: ApiInvokeCommand;

  public readonly timeoutMs: number;

  public constructor(command: ApiInvokeCommand, timeoutMs: number) {
    super(`${command} timed out after ${timeoutMs}ms`);
    this.name = "ApiInvokeTimeoutError";
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function isIdempotentMethod(method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return (
    normalizedMethod === "GET" ||
    normalizedMethod === "HEAD" ||
    normalizedMethod === "OPTIONS"
  );
}

async function invokeWithTimeout<T>(
  task: Promise<T>,
  command: ApiInvokeCommand,
  timeoutMs = API_INVOKE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new ApiInvokeTimeoutError(command, timeoutMs));
    }, timeoutMs);

    task.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function buildInvokeResponse(result: InternalApiInvokeResponse): Response {
  const responseHeaders = new Headers();
  if (result.content_type) {
    responseHeaders.set("Content-Type", result.content_type);
  }

  const responseBody: BodyInit = result.is_base64
    ? (() => {
        const bytes = decodeBase64ToBytes(result.body ?? "");
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        return new Blob([buffer]);
      })()
    : (result.body ?? "");

  return new Response(responseBody, {
    status: result.status,
    headers: responseHeaders,
  });
}

function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

function isIosFamilyRuntime(): boolean {
  if (!isTauriRuntime()) {
    return false;
  }

  const ua = globalThis.navigator.userAgent.toLowerCase();
  return (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    (ua.includes("macintosh") && "ontouchend" in document)
  );
}

function decodeBase64ToBytes(input: string): Uint8Array {
  const binary = globalThis.atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

type ApiAuthTarget = "local" | "remote";

const REMOTE_API_PATH_PREFIXES = [
  "/api/screenshare",
  "/api/downloads",
  "/api/download/start",
  "/api/shared-downloads",
];

function normalizeApiPathname(pathname: string): string {
  if (!pathname) return "";
  if (pathname.startsWith("/")) return pathname;
  return `/${pathname}`;
}

function shouldUseRemoteApi(pathname: string): boolean {
  const normalized = normalizeApiPathname(pathname);
  return REMOTE_API_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

type ApiRequestContext = {
  isApiCall: boolean;
  apiPathname: string;
  resolvedUrl: URL | null;
};

function resolveApiRequestContext(url: string): ApiRequestContext {
  try {
    const resolvedUrl = new URL(url, globalThis.location.origin);
    const apiPathname = resolvedUrl.pathname;
    return {
      isApiCall: apiPathname.startsWith("/api/"),
      apiPathname,
      resolvedUrl,
    };
  } catch {
    if (url.startsWith("/api/")) {
      return {
        isApiCall: true,
        apiPathname: url.split("?")[0],
        resolvedUrl: null,
      };
    }

    if (url.startsWith("api/")) {
      return {
        isApiCall: true,
        apiPathname: `/${url.split("?")[0]}`,
        resolvedUrl: null,
      };
    }

    return {
      isApiCall: false,
      apiPathname: "",
      resolvedUrl: null,
    };
  }
}

function extractInvokeBody(bodyCandidate: BodyInit | null | undefined) {
  if (typeof bodyCandidate === "string") {
    return bodyCandidate;
  }

  if (bodyCandidate instanceof URLSearchParams) {
    return bodyCandidate.toString();
  }

  return undefined;
}

function dispatchTauriApiRequest(
  resolvedUrl: URL | null,
  init: RequestInit | undefined,
  headers: Headers,
  shouldRouteToRemote: boolean,
  serverUrl: string,
): Promise<Response> | null {
  if (!isTauriRuntime() || !resolvedUrl) {
    return null;
  }

  const method = (init?.method || "GET").toUpperCase();
  const body = extractInvokeBody(init?.body);

  // Pairing mode: only selected endpoints are forwarded to Desktop.
  if (shouldRouteToRemote && serverUrl) {
    return invokeRemoteApiViaProxy(
      resolvedUrl,
      method,
      body,
      headers,
      serverUrl,
    );
  }

  // Default path: keep requests on the iOS local backend.
  return invokeInternalApi(resolvedUrl, method, body, headers);
}

function injectApiAuthHeaders(
  init: RequestInit | undefined,
  target: ApiAuthTarget,
): Headers {
  const activeToken = getActiveToken(target);
  const deviceId = getDeviceId();
  const headers = new Headers(init?.headers);

  if (activeToken && !headers.has("x-nsv-token")) {
    headers.set("x-nsv-token", activeToken);
  }
  if (deviceId && !headers.has("x-nsv-device-id")) {
    headers.set("x-nsv-device-id", deviceId);
  }

  return headers;
}

async function invokeInternalApi(
  resolvedUrl: URL,
  method: string,
  body: string | undefined,
  headers: Headers,
): Promise<Response> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const requestPayload = {
      request: {
        method,
        path: resolvedUrl.pathname,
        query: resolvedUrl.search ? resolvedUrl.search.slice(1) : undefined,
        body,
        headers: Object.fromEntries(headers.entries()),
      },
    };

    const maxAttempts =
      (isIdempotentMethod(method) ? API_MAX_IDEMPOTENT_RETRIES : 0) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await invokeWithTimeout(
          invoke<InternalApiInvokeResponse>(
            "internal_api_request",
            requestPayload,
          ),
          "internal_api_request",
        );
        return buildInvokeResponse(result);
      } catch (error) {
        const hasAttemptsLeft = attempt < maxAttempts;
        if (!hasAttemptsLeft) {
          throw error;
        }

        console.warn(
          `[fetch-guard] internal_api_request retry ${attempt}/${maxAttempts - 1}`,
          error,
        );
        await wait(API_RETRY_DELAY_MS * attempt);
      }
    }

    throw new Error("internal_api_request failed unexpectedly");
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const status = error instanceof ApiInvokeTimeoutError ? 504 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function invokeRemoteApiViaProxy(
  resolvedUrl: URL,
  method: string,
  body: string | undefined,
  headers: Headers,
  serverUrl: string,
): Promise<Response> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const requestPayload = {
      serverUrl,
      method,
      path: resolvedUrl.pathname,
      query: resolvedUrl.search ? resolvedUrl.search.slice(1) : undefined,
      body,
      headers: Object.fromEntries(headers.entries()),
    };

    const maxAttempts =
      (isIdempotentMethod(method) ? API_MAX_IDEMPOTENT_RETRIES : 0) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await invokeWithTimeout(
          invoke<InternalApiInvokeResponse>(
            "proxy_remote_request",
            requestPayload,
          ),
          "proxy_remote_request",
        );
        return buildInvokeResponse(result);
      } catch (error) {
        const hasAttemptsLeft = attempt < maxAttempts;
        if (!hasAttemptsLeft) {
          throw error;
        }

        console.warn(
          `[fetch-guard] proxy_remote_request retry ${attempt}/${maxAttempts - 1}`,
          error,
        );
        await wait(API_RETRY_DELAY_MS * attempt);
      }
    }

    throw new Error("proxy_remote_request failed unexpectedly");
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const status = error instanceof ApiInvokeTimeoutError ? 504 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error);
  }
  return String(error);
}

function createDeviceId(): string {
  const api = globalThis.crypto;
  if (api?.randomUUID) {
    return `dev_${api.randomUUID().replaceAll("-", "")}`;
  }
  if (api?.getRandomValues) {
    const bytes = new Uint8Array(12);
    api.getRandomValues(bytes);
    let hex = "";
    for (const byte of bytes) {
      const b = byte.toString(16);
      hex += b.length === 1 ? `0${b}` : b;
    }
    return `dev_${hex}`;
  }
  return `dev_${Date.now().toString(36)}_${(globalThis.performance?.now() ?? 0)
    .toString(36)
    .replace(".", "")}`;
}

function disableAppZoomOnIos(): void {
  if (!isIosFamilyRuntime()) {
    return;
  }

  // Prevents iOS double-tap zoom without cancelling regular tap/click events.
  document.documentElement.style.touchAction = "manipulation";

  const blockGesture = (event: Event) => {
    event.preventDefault();
  };

  document.addEventListener("gesturestart", blockGesture, { passive: false });
  document.addEventListener("gesturechange", blockGesture, {
    passive: false,
  });
  document.addEventListener("gestureend", blockGesture, { passive: false });
}

type TwitchOAuthBridgeStatus = "success" | "error";

type TwitchOAuthBridgePayload = {
  type: "nsv:twitch-auth";
  status: TwitchOAuthBridgeStatus;
  at: number;
  message?: string;
  userLogin?: string;
  userDisplayName?: string;
};

const handledTwitchDeepLinks = new Set<string>();

function parseTwitchOAuthDeepLink(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    const isExpectedProtocol =
      parsed.protocol.toLowerCase() === TWITCH_DEEP_LINK_PROTOCOL;
    if (!isExpectedProtocol) {
      return null;
    }

    const normalizedHost = parsed.hostname.toLowerCase();
    const normalizedPath = parsed.pathname.toLowerCase().replace(/\/+$/, "");

    const isExpectedHost = normalizedHost === TWITCH_DEEP_LINK_HOST;
    const isExpectedPath = normalizedPath === TWITCH_DEEP_LINK_PATH;
    const isCompatibleCallbackPath =
      normalizedPath === "/auth/twitch/callback" ||
      normalizedPath.endsWith("/twitch/callback") ||
      `${normalizedHost}${normalizedPath}`.includes("auth/twitch/callback");

    const hasOAuthParams =
      parsed.searchParams.has("code") ||
      parsed.searchParams.has("error") ||
      parsed.searchParams.has("state");
    const hasBridgeStatusParam = parsed.searchParams.has("status");

    if (
      (isExpectedHost && isExpectedPath) ||
      isCompatibleCallbackPath ||
      hasOAuthParams ||
      hasBridgeStatusParam
    ) {
      return parsed;
    }
  } catch {
    // Ignore invalid URLs.
  }

  return null;
}

function publishTwitchOAuthBridgePayload(payload: TwitchOAuthBridgePayload) {
  try {
    localStorage.setItem(
      TWITCH_OAUTH_STATUS_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Ignore storage failures.
  }

  try {
    globalThis.postMessage(payload, globalThis.location.origin);
  } catch {
    // Ignore dispatch failures.
  }
}

async function exchangeTwitchOAuthFromDeepLink(rawUrl: string): Promise<void> {
  const parsed = parseTwitchOAuthDeepLink(rawUrl);
  if (!parsed) {
    return;
  }

  const bridgeStatusRaw =
    parsed.searchParams.get("status")?.trim().toLowerCase() || "";
  const bridgeStatus: TwitchOAuthBridgeStatus | null =
    bridgeStatusRaw === "success" || bridgeStatusRaw === "error"
      ? bridgeStatusRaw
      : null;

  if (bridgeStatus) {
    publishTwitchOAuthBridgePayload({
      type: "nsv:twitch-auth",
      status: bridgeStatus,
      at: Date.now(),
      message:
        parsed.searchParams.get("message") ||
        (bridgeStatus === "success"
          ? "Compte Twitch lie."
          : "La connexion Twitch a echoue."),
      userLogin: parsed.searchParams.get("userLogin") || undefined,
      userDisplayName: parsed.searchParams.get("userDisplayName") || undefined,
    });
    return;
  }

  const body = {
    code: parsed.searchParams.get("code"),
    state: parsed.searchParams.get("state"),
    error: parsed.searchParams.get("error"),
    error_description: parsed.searchParams.get("error_description"),
  };

  try {
    const response = await fetch("/api/auth/twitch/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      userLogin?: string;
      userDisplayName?: string;
    } | null;

    if (!response.ok) {
      publishTwitchOAuthBridgePayload({
        type: "nsv:twitch-auth",
        status: "error",
        at: Date.now(),
        message:
          payload?.error ||
          "Impossible de finaliser la connexion Twitch depuis le deep link.",
      });
      return;
    }

    publishTwitchOAuthBridgePayload({
      type: "nsv:twitch-auth",
      status: "success",
      at: Date.now(),
      message: "Compte Twitch lie.",
      userLogin: payload?.userLogin,
      userDisplayName: payload?.userDisplayName,
    });
  } catch (error) {
    publishTwitchOAuthBridgePayload({
      type: "nsv:twitch-auth",
      status: "error",
      at: Date.now(),
      message: normalizeErrorMessage(error),
    });
  }
}

async function setupTwitchDeepLinkBridge(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { getCurrent, onOpenUrl } =
      await import("@tauri-apps/plugin-deep-link");

    const processUrls = async (urls: string[] | null | undefined) => {
      if (!Array.isArray(urls) || urls.length === 0) {
        return;
      }

      for (const rawUrl of urls) {
        if (handledTwitchDeepLinks.has(rawUrl)) {
          continue;
        }

        if (!parseTwitchOAuthDeepLink(rawUrl)) {
          continue;
        }

        handledTwitchDeepLinks.add(rawUrl);
        await exchangeTwitchOAuthFromDeepLink(rawUrl);
      }
    };

    await processUrls(await getCurrent());
    await onOpenUrl((urls) => {
      void processUrls(urls);
    });
  } catch (error) {
    console.warn("[deep-link] Twitch OAuth bridge unavailable", error);
  }
}

(function initDeviceId() {
  const existing = safeStorageGet(localStorage, "nsv_device_id");
  if (!existing) {
    safeStorageSet(localStorage, "nsv_device_id", createDeviceId());
  }
})();

// ── Extract and store server auth token from URL ─────────────────────────────
// The QR code URL includes ?t=<token>. We extract it on first load and strip it
// from the URL to avoid leaking it in referrer headers or browser history.
async function initAuthTokenFromUrl() {
  const params = new URLSearchParams(globalThis.location.search);
  const token = params.get("t");
  if (token) {
    await setStandaloneToken(token);
    // Clean the URL without reloading
    params.delete("t");
    const clean = params.toString();
    const newUrl =
      globalThis.location.pathname +
      (clean ? `?${clean}` : "") +
      globalThis.location.hash;
    globalThis.history.replaceState({}, "", newUrl);
  }
}

// ── Patch global fetch to auto-inject auth token on API calls ────────────────
function patchFetch() {
  const originalFetch = globalThis.fetch;

  const isPlayerPlaybackContext = () => {
    try {
      const currentUrl = new URL(globalThis.location.href);
      const hash = (currentUrl.hash || "").toLowerCase();
      return (
        currentUrl.pathname.startsWith("/player") ||
        hash.includes("/player") ||
        currentUrl.searchParams.has("vod") ||
        currentUrl.searchParams.has("live")
      );
    } catch {
      return false;
    }
  };

  globalThis.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = resolveRequestUrl(input);

    // Hard guard: never poll screenshare state while watching player VOD/live.
    if (url.includes("/api/screenshare/state") && isPlayerPlaybackContext()) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            active: false,
            sessionId: null,
            sourceType: null,
            sourceLabel: null,
            startedAt: null,
            interactive: true,
            maxViewers: 5,
            currentViewers: 0,
            streamReady: false,
            streamMessage: null,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }

    // Only inject token on our own API calls
    const { isApiCall, apiPathname, resolvedUrl } =
      resolveApiRequestContext(url);

    if (isApiCall) {
      const serverUrl = safeStorageGet(localStorage, "nsv_server_url");
      const serverToken = getRemoteServerToken();
      const remoteSessionEnabled = Boolean(serverUrl && serverToken);
      const isCrossOriginApiCall =
        resolvedUrl !== null &&
        resolvedUrl.origin !== globalThis.location.origin;
      const shouldRouteToRemote =
        remoteSessionEnabled &&
        (shouldUseRemoteApi(apiPathname) ||
          (apiPathname === "/api/auth/twitch/status" && isCrossOriginApiCall));

      const headers = injectApiAuthHeaders(
        init,
        shouldRouteToRemote ? "remote" : "local",
      );

      const tauriResponse = dispatchTauriApiRequest(
        resolvedUrl,
        init,
        headers,
        shouldRouteToRemote,
        serverUrl,
      );
      if (tauriResponse) {
        // In Tauri runtime, backend API calls must stay on the native bridge
        // (internal_api_request/proxy_remote_request) to avoid HTTP 0 failures.
        return tauriResponse;
      }

      init = { ...init, headers };
    }
    return originalFetch.call(globalThis, input, init);
  };
}

type AppErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  AppErrorBoundaryState
> {
  public constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  public static getDerivedStateFromError(
    error: unknown,
  ): AppErrorBoundaryState {
    return {
      hasError: true,
      message: normalizeErrorMessage(error),
    };
  }

  public override componentDidCatch(error: unknown) {
    console.error("Portal runtime error:", error);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "20px",
            color: "#f7f8ff",
            background: "#07080f",
            minHeight: "100vh",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Portal error</h2>
          <p style={{ marginBottom: 0 }}>
            {this.state.message || "Unknown runtime error"}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

// Expose React globally for extensions to avoid bundling it
(globalThis as any).React = React;

globalThis.addEventListener(APP_READY_EVENT_NAME, dismissLaunchLoader, {
  once: true,
});
globalThis.setTimeout(dismissLaunchLoader, LAUNCH_LOADER_FALLBACK_TIMEOUT_MS);

async function bootstrapPortal() {
  await initializeSecureTokenStorage();
  await initAuthTokenFromUrl();
  patchFetch();
  disableAppZoomOnIos();
  await setupTwitchDeepLinkBridge();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  );
}

void bootstrapPortal();
