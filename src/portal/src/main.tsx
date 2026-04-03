import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { safeStorageGet, safeStorageSet } from "../../shared/utils/storage";

type InternalApiInvokeResponse = {
  status: number;
  body: string;
  is_base64?: boolean;
  content_type?: string | null;
};

function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
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

function injectApiAuthHeaders(init: RequestInit | undefined): Headers {
    const standaloneToken =
      safeStorageGet(sessionStorage, "nsv_token") ||
      safeStorageGet(localStorage, "nsv_token");
    const serverUrl = safeStorageGet(localStorage, "nsv_server_url");
    const pairedToken = safeStorageGet(localStorage, "nsv_server_token");

    const activeToken = (serverUrl && pairedToken) ? pairedToken : standaloneToken;
    const deviceId = safeStorageGet(localStorage, "nsv_device_id");
    const headers = new Headers(init?.headers);

    if (activeToken && !headers.has("x-nsv-token")) {
      headers.set("x-nsv-token", activeToken);
  if (deviceId && !headers.has("x-nsv-device-id")) {
    headers.set("x-nsv-device-id", deviceId);
  }

  return headers;
}

function resolveApiUrl(url: string): URL {
  if (url.startsWith("/")) {
    return new URL(url, globalThis.location.origin);
  }
  if (url.startsWith("api/")) {
    return new URL(`/${url}`, globalThis.location.origin);
  }
  return new URL(url, globalThis.location.origin);
}

async function invokeInternalApi(
  resolvedUrl: URL,
  method: string,
  body: string | undefined,
  headers: Headers,
): Promise<Response> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<InternalApiInvokeResponse>(
      "internal_api_request",
      {
        request: {
          method,
          path: resolvedUrl.pathname,
          query: resolvedUrl.search ? resolvedUrl.search.slice(1) : undefined,
          body,
          headers: Object.fromEntries(headers.entries()),
        },
      },
    );

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
  } catch (error) {
    const message = normalizeErrorMessage(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
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
    const result = await invoke<InternalApiInvokeResponse>(
      "proxy_remote_request",
      {
        serverUrl,
        method,
        path: resolvedUrl.pathname,
        query: resolvedUrl.search ? resolvedUrl.search.slice(1) : undefined,
        body,
        headers: Object.fromEntries(headers.entries()),
      },
    );

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
  } catch (error) {
    const message = normalizeErrorMessage(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
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
  return `dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

(function initDeviceId() {
  const existing = safeStorageGet(localStorage, "nsv_device_id");
  if (!existing) {
    safeStorageSet(localStorage, "nsv_device_id", createDeviceId());
  }
})();

// ── Extract and store server auth token from URL ─────────────────────────────
// The QR code URL includes ?t=<token>. We extract it on first load, store it
// in sessionStorage (survives navigations but not tab close), and strip it from
// the URL to avoid leaking it in referrer headers or browser history.
(function initAuthToken() {
  const params = new URLSearchParams(globalThis.location.search);
  const token = params.get("t");
  if (token) {
    safeStorageSet(sessionStorage, "nsv_token", token);
    safeStorageSet(localStorage, "nsv_token", token);
    // Clean the URL without reloading
    params.delete("t");
    const clean = params.toString();
    const newUrl =
      globalThis.location.pathname +
      (clean ? `?${clean}` : "") +
      globalThis.location.hash;
    globalThis.history.replaceState({}, "", newUrl);
  }
})();

// ── Patch global fetch to auto-inject auth token on API calls ────────────────
(function patchFetch() {
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
    let isApiCall = false;
    let resolvedUrl: URL | null = null;
    try {
      resolvedUrl = new URL(url, globalThis.location.origin);
      isApiCall = resolvedUrl.pathname.startsWith("/api/");
    } catch {
      isApiCall = url.startsWith("/api/") || url.startsWith("api/");
    }

    if (isApiCall) {
      const headers = injectApiAuthHeaders(init);

      if (isTauriRuntime() && resolvedUrl) {
        const method = (init?.method || "GET").toUpperCase();
        const bodyCandidate = init?.body;
        let body: string | undefined;
        if (typeof bodyCandidate === "string") {
          body = bodyCandidate;
        } else if (bodyCandidate instanceof URLSearchParams) {
          body = bodyCandidate.toString();
        }

        const serverUrl = safeStorageGet(localStorage, "nsv_server_url");
        const serverToken = safeStorageGet(localStorage, "nsv_server_token");

        // Mode Paired -> Proxy vers Serveur Desktop
        if (serverUrl && serverToken) {
          return invokeRemoteApiViaProxy(resolvedUrl, method, body, headers, serverUrl);
        }
        
        // Mode Standalone -> Appel Rust Local
        return invokeInternalApi(resolvedUrl, method, body, headers);
      }

      init = { ...init, headers };
    }
    return originalFetch.call(globalThis, input, init);
  };
})();

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
