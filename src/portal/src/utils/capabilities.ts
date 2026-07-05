/**
 * Returns true when running inside the Tauri native runtime (iOS app shell).
 * This is the single source of truth — do NOT redefine this in other files.
 */
export function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

/**
 * Returns true when running on an iOS touch device inside Tauri.
 * Covers iPhone, iPad, iPod and Mac Catalyst (macintosh + touchend).
 */
export function isIosTouchRuntime(): boolean {
  if (!isTauriRuntime()) return false;
  const ua = globalThis.navigator?.userAgent?.toLowerCase() ?? "";
  return (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    (ua.includes("macintosh") && "ontouchend" in document)
  );
}

export function isIOSFamily(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;

  const ua = (nav.userAgent || "").toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return true;
  }

  return ua.includes("macintosh") && (nav.maxTouchPoints || 0) > 1;
}

export function isMobileDevice(): boolean {
  return isIOSFamily();
}

export function canUseHlsJs(): boolean {
  // iOS-only build: always force native AVPlayer for HLS playback.
  return false;
}

export function canPlayHlsNatively(): boolean {
  if (typeof document === "undefined") return false;
  const video = document.createElement("video");
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}
