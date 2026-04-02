export function initEruda(state: boolean) {
  const debugMode = state;
  try {
    if (debugMode !== true) return;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = function () {
      if (
        (globalThis as any).eruda &&
        typeof (globalThis as any).eruda.init === "function"
      ) {
        (globalThis as any).eruda.init();
      }
    };
    document.head.appendChild(script);
  } catch {
    // Ignore optional debug tooling errors.
  }
}
