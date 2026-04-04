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

type DebugGlobal = typeof globalThis & {
  eruda?: {
    init?: () => void;
    destroy?: () => void;
  };
  __NSV_BENCHMARK__?: BenchmarkApi;
};

const BENCHMARK_PANEL_ID = "nsv-benchmark-panel";
const BENCHMARK_STYLE_ID = "nsv-benchmark-style";
const BENCHMARK_SCRIPT_ID = "nsv-eruda-script";

const benchmarkStartTimes = new Map<string, number>();
let erudaLoadPromise: Promise<void> | null = null;
let erudaEnabled = false;
let debugCleanups: Cleanup[] = [];

function getDebugGlobal(): DebugGlobal {
  return globalThis as DebugGlobal;
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
      existing.addEventListener("error", () => reject(new Error("eruda-load-failed")), {
        once: true,
      });
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
