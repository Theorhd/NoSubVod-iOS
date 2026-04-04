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
