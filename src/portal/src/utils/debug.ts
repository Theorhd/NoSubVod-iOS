type Cleanup = () => void;

type BenchmarkApi = {
  markStart: (label: string) => void;
  markEnd: (label: string) => number | null;
  measureAsync: <T>(label: string, task: () => Promise<T>) => Promise<T>;
};

type MemoryPerformance = Performance & {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

type LoggerLevel = "debug" | "info" | "warn" | "error";

type LoggerEntry = {
  id: number;
  at: number;
  isoTime: string;
  sessionId: string;
  level: LoggerLevel;
  source: string;
  message: string;
  context?: Record<string, unknown>;
};

type LoggerExportPayload = {
  schemaVersion: number;
  generatedAt: string;
  sessionId: string;
  userAgent: string;
  location: string;
  reason: string;
  totalEntries: number;
  entries: LoggerEntry[];
};

type LoggerApi = {
  readonly enabled: boolean;
  readonly sessionId: string;
  log: (
    level: LoggerLevel,
    source: string,
    message: string,
    context?: Record<string, unknown>,
  ) => void;
  component: (
    componentName: string,
    phase: string,
    context?: Record<string, unknown>,
  ) => void;
  getEntries: () => LoggerEntry[];
  exportLogs: (reason?: string) => LoggerExportPayload;
  download: (reason?: string) => Promise<string | null>;
  clear: () => void;
};

type NavigatorWithShare = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

type LoggerActiveSession = {
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  route: string;
  entryCount: number;
  endedAt?: string;
};

type DebugGlobal = typeof globalThis & {
  eruda?: {
    init?: () => void;
    destroy?: () => void;
  };
  __NSV_BENCHMARK__?: BenchmarkApi;
  __NSV_LOGGER__?: LoggerApi;
  __NSV_EXPORT_LOGS__?: (reason?: string) => Promise<string | null>;
};

const BENCHMARK_PANEL_ID = "nsv-benchmark-panel";
const BENCHMARK_STYLE_ID = "nsv-benchmark-style";
const BENCHMARK_SCRIPT_ID = "nsv-eruda-script";

const LOGGER_STORAGE_KEY = "nsv_logger_entries_v1";
const LOGGER_ACTIVE_SESSION_KEY = "nsv_logger_active_session_v1";
const LOGGER_MAX_ENTRIES = 2200;
const LOGGER_MAX_CONTEXT_DEPTH = 4;
const LOGGER_MAX_STRING_LENGTH = 2400;
const LOGGER_HEARTBEAT_MS = 15000;
const LOGGER_SCHEMA_VERSION = 1;

const benchmarkStartTimes = new Map<string, number>();
let erudaLoadPromise: Promise<void> | null = null;
let erudaEnabled = false;
let debugCleanups: Cleanup[] = [];

let loggerEnabled = false;
let loggerSessionId = "";
let loggerSequence = 0;
let loggerEntries: LoggerEntry[] = [];
let loggerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let loggerCleanups: Cleanup[] = [];
let loggerInitialized = false;
let loggerStartedAt = "";

const loggerOriginalConsole: Partial<
  Record<
    "log" | "info" | "warn" | "error" | "debug",
    (...args: unknown[]) => void
  >
> = {};

function getDebugGlobal(): DebugGlobal {
  return globalThis as DebugGlobal;
}

function loggerNowIso(): string {
  return new Date().toISOString();
}

function generateLoggerSessionId(): string {
  const api = globalThis.crypto;
  if (api?.randomUUID) {
    return api.randomUUID().replaceAll("-", "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function safeStorageGetRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSetRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function serializeSimpleValue(value: unknown): {
  handled: boolean;
  serialized: unknown;
} {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return { handled: true, serialized: value };
  }

  if (typeof value === "string") {
    if (value.length <= LOGGER_MAX_STRING_LENGTH) {
      return { handled: true, serialized: value };
    }
    return {
      handled: true,
      serialized: `${value.slice(0, LOGGER_MAX_STRING_LENGTH)}...`,
    };
  }

  if (typeof value === "bigint") {
    return { handled: true, serialized: value.toString() };
  }

  if (value instanceof Date) {
    return { handled: true, serialized: value.toISOString() };
  }

  if (value instanceof URL) {
    return { handled: true, serialized: value.toString() };
  }

  if (value instanceof Error) {
    return {
      handled: true,
      serialized: {
        name: value.name,
        message: value.message,
        stack: value.stack,
      },
    };
  }

  if (typeof value === "function") {
    return {
      handled: true,
      serialized: `[function ${value.name || "anonymous"}]`,
    };
  }

  return { handled: false, serialized: undefined };
}

function toSerializable(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (depth > LOGGER_MAX_CONTEXT_DEPTH) {
    return "[max-depth]";
  }

  const simple = serializeSimpleValue(value);
  if (simple.handled) {
    return simple.serialized;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 80)
      .map((item) => toSerializable(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      return "[circular]";
    }

    seen.add(objectValue);
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(objectValue).slice(0, 120)) {
      output[key] = toSerializable(nested, depth + 1, seen);
    }
    return output;
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  return `[${typeof value}]`;
}

function sanitizeLogText(raw: string): string {
  return raw
    .replaceAll(
      /([?&](?:t|token|access_token|client_secret|code)=)[^&\s]+/gi,
      "$1<redacted>",
    )
    .replaceAll(/(authorization[:=]\s*bearer\s+)[\w.-]+/gi, "$1<redacted>");
}

function formatConsoleArgs(args: unknown[]): string {
  return sanitizeLogText(
    args
      .map((value) => {
        if (typeof value === "string") return value;
        if (value instanceof Error) {
          const stackText = value.stack ? `\n${value.stack}` : "";
          return `${value.name}: ${value.message}${stackText}`;
        }
        try {
          return JSON.stringify(toSerializable(value));
        } catch {
          return String(value);
        }
      })
      .join(" "),
  );
}

function loadLoggerEntriesFromStorage(): LoggerEntry[] {
  const parsed = safeJsonParse<LoggerEntry[]>(
    safeStorageGetRaw(LOGGER_STORAGE_KEY),
    [],
  );
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(
      (entry) =>
        typeof entry?.id === "number" &&
        typeof entry?.at === "number" &&
        typeof entry?.isoTime === "string" &&
        typeof entry?.sessionId === "string" &&
        typeof entry?.level === "string" &&
        typeof entry?.source === "string" &&
        typeof entry?.message === "string",
    )
    .slice(-LOGGER_MAX_ENTRIES);
}

function persistLoggerEntries() {
  try {
    safeStorageSetRaw(LOGGER_STORAGE_KEY, JSON.stringify(loggerEntries));
  } catch {
    // localStorage quota may be reached; trim and retry once.
    loggerEntries = loggerEntries.slice(-Math.floor(LOGGER_MAX_ENTRIES / 2));
    try {
      safeStorageSetRaw(LOGGER_STORAGE_KEY, JSON.stringify(loggerEntries));
    } catch {
      // Give up quietly.
    }
  }
}

function readActiveLoggerSession(): LoggerActiveSession | null {
  return safeJsonParse<LoggerActiveSession | null>(
    safeStorageGetRaw(LOGGER_ACTIVE_SESSION_KEY),
    null,
  );
}

function writeActiveLoggerSession(payload: LoggerActiveSession) {
  safeStorageSetRaw(LOGGER_ACTIVE_SESSION_KEY, JSON.stringify(payload));
}

function markLoggerSessionEnded() {
  const existing = readActiveLoggerSession();
  if (existing?.sessionId !== loggerSessionId) {
    return;
  }

  writeActiveLoggerSession({
    ...existing,
    endedAt: loggerNowIso(),
    lastSeenAt: loggerNowIso(),
    entryCount: loggerEntries.length,
  });
}

function loggerRuntimeContext(): Record<string, unknown> {
  return {
    route: `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`,
    visibility: document.visibilityState,
    online: navigator.onLine,
  };
}

function appendLoggerEntry(
  level: LoggerLevel,
  source: string,
  message: string,
  context?: Record<string, unknown>,
) {
  if (!loggerEnabled) {
    return;
  }

  loggerSequence += 1;
  const entry: LoggerEntry = {
    id: loggerSequence,
    at: Date.now(),
    isoTime: loggerNowIso(),
    sessionId: loggerSessionId,
    level,
    source,
    message: sanitizeLogText(message),
    context: context
      ? (toSerializable(context) as Record<string, unknown>)
      : undefined,
  };

  loggerEntries.push(entry);
  if (loggerEntries.length > LOGGER_MAX_ENTRIES) {
    loggerEntries = loggerEntries.slice(-LOGGER_MAX_ENTRIES);
  }

  persistLoggerEntries();
}

function initLoggerConsolePatch(): Cleanup {
  const levelByMethod: Record<
    "log" | "info" | "warn" | "error" | "debug",
    LoggerLevel
  > = {
    log: "info",
    info: "info",
    warn: "warn",
    error: "error",
    debug: "debug",
  };

  const methods = ["log", "info", "warn", "error", "debug"] as const;
  for (const method of methods) {
    const current = console[method];
    if (typeof current !== "function") continue;

    const bound = current.bind(console) as (...args: unknown[]) => void;
    loggerOriginalConsole[method] = bound;

    (console as unknown as Record<string, (...args: unknown[]) => void>)[
      method
    ] = (...args: unknown[]) => {
      appendLoggerEntry(
        levelByMethod[method],
        "console",
        formatConsoleArgs(args),
        {
          ...loggerRuntimeContext(),
        },
      );
      bound(...args);
    };
  }

  return () => {
    for (const method of methods) {
      const original = loggerOriginalConsole[method];
      if (!original) continue;
      (console as unknown as Record<string, (...args: unknown[]) => void>)[
        method
      ] = original;
    }
  };
}

function initLoggerRuntimeEvents(): Cleanup {
  const onError = (event: ErrorEvent) => {
    appendLoggerEntry(
      "error",
      "runtime",
      event.message || "Unhandled runtime error",
      {
        ...loggerRuntimeContext(),
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: toSerializable(event.error),
      },
    );
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    appendLoggerEntry("error", "runtime", "Unhandled promise rejection", {
      ...loggerRuntimeContext(),
      reason: toSerializable(event.reason),
    });
  };

  const onVisibilityChange = () => {
    appendLoggerEntry("info", "runtime", "visibilitychange", {
      ...loggerRuntimeContext(),
    });
  };

  const onOnline = () => {
    appendLoggerEntry("info", "runtime", "network-online", {
      ...loggerRuntimeContext(),
    });
  };

  const onOffline = () => {
    appendLoggerEntry("warn", "runtime", "network-offline", {
      ...loggerRuntimeContext(),
    });
  };

  const onPageShow = () => {
    appendLoggerEntry("info", "runtime", "pageshow", {
      ...loggerRuntimeContext(),
    });
  };

  const onPageHide = () => {
    appendLoggerEntry("info", "runtime", "pagehide", {
      ...loggerRuntimeContext(),
    });
  };

  const onBeforeUnload = () => {
    markLoggerSessionEnded();
  };

  globalThis.addEventListener("error", onError);
  globalThis.addEventListener("unhandledrejection", onUnhandledRejection);
  document.addEventListener("visibilitychange", onVisibilityChange);
  globalThis.addEventListener("online", onOnline);
  globalThis.addEventListener("offline", onOffline);
  globalThis.addEventListener("pageshow", onPageShow);
  globalThis.addEventListener("pagehide", onPageHide);
  globalThis.addEventListener("beforeunload", onBeforeUnload);

  return () => {
    globalThis.removeEventListener("error", onError);
    globalThis.removeEventListener("unhandledrejection", onUnhandledRejection);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    globalThis.removeEventListener("online", onOnline);
    globalThis.removeEventListener("offline", onOffline);
    globalThis.removeEventListener("pageshow", onPageShow);
    globalThis.removeEventListener("pagehide", onPageHide);
    globalThis.removeEventListener("beforeunload", onBeforeUnload);
  };
}

function buildLoggerExport(reason = "manual"): LoggerExportPayload {
  return {
    schemaVersion: LOGGER_SCHEMA_VERSION,
    generatedAt: loggerNowIso(),
    sessionId: loggerSessionId,
    userAgent: navigator.userAgent,
    location: `${globalThis.location.origin}${globalThis.location.pathname}`,
    reason,
    totalEntries: loggerEntries.length,
    entries: [...loggerEntries],
  };
}

function buildLoggerFileName(reason: string): string {
  const compactReason =
    reason
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, "-")
      .replaceAll(/-{2,}/g, "-")
      .replaceAll(/(^-|-$)/g, "") || "manual";
  const stamp = loggerNowIso().replaceAll(/[:.]/g, "-");
  return `nosubvod-logs-${compactReason}-${stamp}.json`;
}

async function downloadLogger(reason = "manual"): Promise<string | null> {
  const payload = buildLoggerExport(reason);
  const fileName = buildLoggerFileName(reason);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });

  const shareNavigator = navigator as NavigatorWithShare;
  try {
    if (
      typeof File !== "undefined" &&
      typeof shareNavigator.share === "function"
    ) {
      const file = new File([blob], fileName, { type: "application/json" });
      const canShare =
        typeof shareNavigator.canShare !== "function" ||
        shareNavigator.canShare({ files: [file] });

      if (canShare) {
        await shareNavigator.share({
          title: "NoSubVOD logs",
          files: [file],
        });
        return fileName;
      }
    }
  } catch {
    // Ignore share failures and fallback to browser download.
  }

  try {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return fileName;
  } catch {
    return null;
  }
}

function clearLoggerEntries() {
  loggerEntries = [];
  loggerSequence = 0;
  persistLoggerEntries();
}

function exposeLoggerApi() {
  const runtimeGlobal = getDebugGlobal();

  const api: LoggerApi = {
    get enabled() {
      return loggerEnabled;
    },
    get sessionId() {
      return loggerSessionId;
    },
    log(level, source, message, context) {
      appendLoggerEntry(level, source, message, context);
    },
    component(componentName, phase, context) {
      appendLoggerEntry(
        "info",
        "component",
        `${componentName}:${phase}`,
        context,
      );
    },
    getEntries() {
      return [...loggerEntries];
    },
    exportLogs(reason = "manual") {
      return buildLoggerExport(reason);
    },
    download(reason = "manual") {
      return downloadLogger(reason);
    },
    clear() {
      clearLoggerEntries();
    },
  };

  runtimeGlobal.__NSV_LOGGER__ = api;
  runtimeGlobal.__NSV_EXPORT_LOGS__ = (reason = "manual") =>
    api.download(reason);
}

function teardownNSVLogger() {
  for (const cleanup of loggerCleanups) {
    cleanup();
  }
  loggerCleanups = [];

  if (loggerHeartbeatTimer !== null) {
    globalThis.clearInterval(loggerHeartbeatTimer);
    loggerHeartbeatTimer = null;
  }

  if (loggerEnabled) {
    markLoggerSessionEnded();
  }

  loggerEnabled = false;
}

export function initNSVLogger(enabled: boolean) {
  teardownNSVLogger();

  const hadLoggerInitialized = loggerInitialized;
  loggerEntries = loadLoggerEntriesFromStorage();
  loggerSequence = loggerEntries[loggerEntries.length - 1]?.id ?? 0;
  loggerSessionId = generateLoggerSessionId();
  loggerStartedAt = loggerNowIso();

  exposeLoggerApi();

  if (!enabled) {
    loggerInitialized = false;
    loggerStartedAt = "";
    return;
  }

  const previousSession = readActiveLoggerSession();

  loggerEnabled = true;
  loggerInitialized = true;

  writeActiveLoggerSession({
    sessionId: loggerSessionId,
    startedAt: loggerStartedAt,
    lastSeenAt: loggerNowIso(),
    route: `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`,
    entryCount: loggerEntries.length,
  });

  loggerCleanups.push(initLoggerConsolePatch(), initLoggerRuntimeEvents());

  loggerHeartbeatTimer = globalThis.setInterval(() => {
    if (!loggerEnabled) return;
    writeActiveLoggerSession({
      sessionId: loggerSessionId,
      startedAt: loggerStartedAt,
      lastSeenAt: loggerNowIso(),
      route: `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`,
      entryCount: loggerEntries.length,
    });
  }, LOGGER_HEARTBEAT_MS);

  appendLoggerEntry("info", "logger", "logger-started", {
    ...loggerRuntimeContext(),
    existingEntries: loggerEntries.length,
    loggerInitializedPreviously: hadLoggerInitialized,
  });

  if (previousSession && !previousSession.endedAt) {
    appendLoggerEntry("warn", "logger", "possible-previous-crash-detected", {
      previousSession,
    });
  }
}

export function nsvComponentLog(
  componentName: string,
  phase: string,
  context?: Record<string, unknown>,
) {
  appendLoggerEntry("info", "component", `${componentName}:${phase}`, context);
}

function ensureBenchmarkStyle() {
  if (document.getElementById(BENCHMARK_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = BENCHMARK_STYLE_ID;
  style.textContent = `
    #${BENCHMARK_PANEL_ID} {
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483647;
      min-width: 220px;
      max-width: 280px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.35;
      color: #f5f7ff;
      background: rgba(5, 12, 24, 0.92);
      border: 1px solid rgba(122, 156, 255, 0.45);
      border-radius: 10px;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
      padding: 8px 10px;
      backdrop-filter: blur(4px);
    }

    #${BENCHMARK_PANEL_ID} [data-benchmark-title] {
      display: block;
      margin-bottom: 6px;
      color: #a9c3ff;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    #${BENCHMARK_PANEL_ID} [data-benchmark-line] {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #e7efff;
    }
  `;
  document.head.appendChild(style);
}

function ensureBenchmarkPanel(): HTMLDivElement {
  const existing = document.getElementById(BENCHMARK_PANEL_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const panel = document.createElement("div");
  panel.id = BENCHMARK_PANEL_ID;

  const title = document.createElement("span");
  title.dataset.benchmarkTitle = "true";
  title.textContent = "NoSubVod Benchmark";
  panel.appendChild(title);

  document.body.appendChild(panel);
  return panel;
}

function updatePanelMetric(metric: string, value: string) {
  const panel = ensureBenchmarkPanel();
  let line = panel.querySelector(
    `[data-benchmark-line="${metric}"]`,
  ) as HTMLDivElement | null;

  if (!line) {
    line = document.createElement("div");
    line.dataset.benchmarkLine = metric;
    panel.appendChild(line);
  }

  line.textContent = value;
}

function clearBenchmarkPanel() {
  document.getElementById(BENCHMARK_PANEL_ID)?.remove();
}

function normalizeLabel(label: string): string {
  return label.trim().replaceAll(/\s+/g, "-").toLowerCase();
}

function markBenchmarkStart(label: string) {
  const normalized = normalizeLabel(label);
  const start = performance.now();
  benchmarkStartTimes.set(normalized, start);
  performance.mark(`nsv-start:${normalized}`);
}

function markBenchmarkEnd(label: string): number | null {
  const normalized = normalizeLabel(label);
  const start = benchmarkStartTimes.get(normalized);
  if (start === undefined) return null;

  const endMark = `nsv-end:${normalized}`;
  const startMark = `nsv-start:${normalized}`;
  performance.mark(endMark);
  performance.measure(`nsv-measure:${normalized}`, startMark, endMark);

  benchmarkStartTimes.delete(normalized);
  const duration = performance.now() - start;
  const durationText = `${duration.toFixed(2)} ms`;
  updatePanelMetric("last", `Last: ${label} -> ${durationText}`);
  console.info(`[Benchmark] ${label}: ${durationText}`);
  return duration;
}

async function measureAsyncBenchmark<T>(
  label: string,
  task: () => Promise<T>,
): Promise<T> {
  markBenchmarkStart(label);
  try {
    return await task();
  } finally {
    markBenchmarkEnd(label);
  }
}

function exposeBenchmarkApi(state: boolean): Cleanup {
  const runtimeGlobal = getDebugGlobal();

  if (!state) {
    delete runtimeGlobal.__NSV_BENCHMARK__;
    return () => {
      // no-op
    };
  }

  runtimeGlobal.__NSV_BENCHMARK__ = {
    markStart: markBenchmarkStart,
    markEnd: markBenchmarkEnd,
    measureAsync: measureAsyncBenchmark,
  };

  return () => {
    delete runtimeGlobal.__NSV_BENCHMARK__;
  };
}

function initFpsBenchmark(state: boolean): Cleanup {
  if (!state) {
    return () => {
      // no-op
    };
  }

  let frameCount = 0;
  let lastSampleAt = performance.now();
  let rafId = 0;

  const onFrame = (now: number) => {
    frameCount += 1;
    const elapsed = now - lastSampleAt;
    if (elapsed >= 1000) {
      const fps = Math.round((frameCount * 1000) / elapsed);
      updatePanelMetric("fps", `FPS: ${fps}`);
      frameCount = 0;
      lastSampleAt = now;
    }
    rafId = globalThis.requestAnimationFrame(onFrame);
  };

  rafId = globalThis.requestAnimationFrame(onFrame);

  return () => {
    globalThis.cancelAnimationFrame(rafId);
  };
}

function initLongTaskBenchmark(state: boolean): Cleanup {
  if (!state) {
    return () => {
      // no-op
    };
  }

  if (typeof PerformanceObserver === "undefined") {
    updatePanelMetric("long-task", "LongTasks: unsupported");
    return () => {
      // no-op
    };
  }

  const supportedEntries = PerformanceObserver.supportedEntryTypes ?? [];
  if (!supportedEntries.includes("longtask")) {
    updatePanelMetric("long-task", "LongTasks: unavailable");
    return () => {
      // no-op
    };
  }

  let count = 0;
  const observer = new PerformanceObserver((entryList) => {
    const entries = entryList.getEntries();
    if (entries.length === 0) return;
    count += entries.length;

    const lastDuration = entries[entries.length - 1]?.duration ?? 0;
    updatePanelMetric(
      "long-task",
      `LongTasks: ${count} (last ${lastDuration.toFixed(0)} ms)`,
    );
  });

  observer.observe({ entryTypes: ["longtask"] });

  return () => {
    observer.disconnect();
  };
}

function initMemoryBenchmark(state: boolean): Cleanup {
  if (!state) {
    return () => {
      // no-op
    };
  }

  const perf = performance as MemoryPerformance;
  if (!perf.memory) {
    updatePanelMetric("heap", "Heap: unavailable");
    return () => {
      // no-op
    };
  }

  const updateMemory = () => {
    const used = perf.memory?.usedJSHeapSize ?? 0;
    const limit = perf.memory?.jsHeapSizeLimit ?? 0;

    const usedMb = (used / (1024 * 1024)).toFixed(1);
    const limitMb = (limit / (1024 * 1024)).toFixed(1);
    updatePanelMetric("heap", `Heap: ${usedMb} / ${limitMb} MB`);
  };

  updateMemory();
  const timer = globalThis.setInterval(updateMemory, 2000);

  return () => {
    globalThis.clearInterval(timer);
  };
}

function clearDebugTools() {
  const runtimeGlobal = getDebugGlobal();

  for (const cleanup of debugCleanups) {
    cleanup();
  }
  debugCleanups = [];

  benchmarkStartTimes.clear();
  clearBenchmarkPanel();
  delete runtimeGlobal.__NSV_BENCHMARK__;
}

function loadErudaScript(): Promise<void> {
  const runtimeGlobal = getDebugGlobal();
  if (runtimeGlobal.eruda && typeof runtimeGlobal.eruda.init === "function") {
    return Promise.resolve();
  }

  if (erudaLoadPromise) {
    return erudaLoadPromise;
  }

  erudaLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(BENCHMARK_SCRIPT_ID);
    if (existing instanceof HTMLScriptElement) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("eruda-load-failed")),
        {
          once: true,
        },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = BENCHMARK_SCRIPT_ID;
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("eruda-load-failed"));
    document.head.appendChild(script);
  });

  return erudaLoadPromise;
}

export function initEruda(state: boolean) {
  const runtimeGlobal = getDebugGlobal();

  try {
    if (!state) {
      if (erudaEnabled && typeof runtimeGlobal.eruda?.destroy === "function") {
        runtimeGlobal.eruda.destroy();
      }
      erudaEnabled = false;
      return;
    }

    void loadErudaScript()
      .then(() => {
        if (typeof runtimeGlobal.eruda?.init === "function") {
          runtimeGlobal.eruda.init();
          erudaEnabled = true;
        }
      })
      .catch(() => {
        console.warn("[DebugTools] Eruda loading failed");
      });
  } catch {
    // Ignore optional debug tooling errors.
  }
}

export function initDebugTools(state: boolean) {
  clearDebugTools();
  initEruda(false);

  if (state !== true) {
    return;
  }

  ensureBenchmarkStyle();
  ensureBenchmarkPanel();
  updatePanelMetric("status", "Mode: enabled");

  debugCleanups.push(
    exposeBenchmarkApi(true),
    initFpsBenchmark(true),
    initLongTaskBenchmark(true),
    initMemoryBenchmark(true),
  );

  updatePanelMetric("help", "API: window.__NSV_BENCHMARK__");
  initEruda(true);
}

export function benchmarkStart(label: string) {
  markBenchmarkStart(label);
}

export function benchmarkEnd(label: string): number | null {
  return markBenchmarkEnd(label);
}

export async function benchmarkAsync<T>(
  label: string,
  task: () => Promise<T>,
): Promise<T> {
  return measureAsyncBenchmark(label, task);
}
