import { useState, useEffect, useCallback } from "react";
import { safeStorageGet, safeStorageSet } from "../utils/storage";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const existingToken =
      safeStorageGet(sessionStorage, "nsv_token") ||
      safeStorageGet(localStorage, "nsv_token");
    if (existingToken) return true;

    try {
      const currentUrl = new URL(globalThis.location.href);
      const queryToken = currentUrl.searchParams.get("t")?.trim();
      if (queryToken) {
        safeStorageSet(sessionStorage, "nsv_token", queryToken);
        safeStorageSet(localStorage, "nsv_token", queryToken);
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const token =
        safeStorageGet(sessionStorage, "nsv_token") ||
        safeStorageGet(localStorage, "nsv_token");
      setIsAuthenticated(!!token);
    };
    globalThis.addEventListener("storage", handleStorageChange);
    return () => globalThis.removeEventListener("storage", handleStorageChange);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("nsv_token");
    localStorage.removeItem("nsv_token");
    setIsAuthenticated(false);
  }, []);

  return { isAuthenticated, logout };
}
