import { useEffect, useState } from "react";

export function usePageVisibility() {
  const [isPageVisible, setIsPageVisible] = useState(
    () => document.visibilityState === "visible",
  );

  useEffect(() => {
    const updateVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", updateVisibility);
    globalThis.addEventListener("pageshow", updateVisibility);
    globalThis.addEventListener("focus", updateVisibility);

    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      globalThis.removeEventListener("pageshow", updateVisibility);
      globalThis.removeEventListener("focus", updateVisibility);
    };
  }, []);

  return isPageVisible;
}