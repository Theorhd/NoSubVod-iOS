export function isIOSFamily(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;

  const ua = (nav.userAgent || "").toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return true;
  }

  return ua.includes("macintosh") && (nav.maxTouchPoints || 0) > 1;
}

export function isAndroid(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;
  return /android/i.test(nav.userAgent || "");
}

export function isMobileDevice(): boolean {
  return isIOSFamily() || isAndroid();
}

export function canUseGetUserMedia(): boolean {
  return (
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  );
}

export function canUseDisplayCapture(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

export function canUseHlsJs(): boolean {
  return globalThis.window !== undefined && typeof MediaSource !== "undefined";
}

export function canPlayHlsNatively(): boolean {
  if (typeof document === "undefined") return false;
  const video = document.createElement("video");
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}
