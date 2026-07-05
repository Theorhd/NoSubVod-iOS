import { useState, useEffect } from "react";

export function useResponsive() {
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => globalThis.innerWidth <= 900,
  );
  const [isLandscape, setIsLandscape] = useState(
    () => globalThis.innerWidth > globalThis.innerHeight,
  );
  const [isTouchDevice, setIsTouchDevice] = useState(() =>
    Boolean(
      "ontouchstart" in globalThis ||
      (globalThis.navigator?.maxTouchPoints ?? 0) > 0 ||
      (globalThis.navigator as any)?.msMaxTouchPoints > 0,
    ),
  );

  useEffect(() => {
    const updateLayoutMode = () => {
      setIsMobileLayout(globalThis.innerWidth <= 900);
      setIsLandscape(globalThis.innerWidth > globalThis.innerHeight);
      setIsTouchDevice(
        Boolean(
          "ontouchstart" in globalThis ||
          (globalThis.navigator?.maxTouchPoints ?? 0) > 0 ||
          (globalThis.navigator as any)?.msMaxTouchPoints > 0,
        ),
      );
    };

    updateLayoutMode();
    globalThis.addEventListener("resize", updateLayoutMode);
    return () => globalThis.removeEventListener("resize", updateLayoutMode);
  }, []);

  return { isMobileLayout, isTouchDevice, isLandscape };
}
