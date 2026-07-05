import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Extension, ExtensionContribution } from "../../shared/types";
import { getActiveToken } from "./utils/authTokens";
import "./styles/Extension.css";

interface ExtensionContextType {
  extensions: Extension[];
  enabledExtensions: string[];
  contributions: ExtensionContribution[];
  registerContribution: (contribution: ExtensionContribution) => void;
  toggleExtension: (id: string, enabled: boolean) => Promise<void>;
  isLoading: boolean;
}

const ExtensionContext = createContext<ExtensionContextType | undefined>(
  undefined,
);

const ExtensionIframe = ({
  src,
  title,
}: Readonly<{ src: string; title: string }>) => (
  <iframe src={src} className="extension-iframe" title={title} />
);

const ExtensionNavIcon = () => <div className="extension-nav-icon">🧩</div>;

function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

export function ExtensionProvider({
  children,
  suspendLoading = false,
}: Readonly<{ children: React.ReactNode; suspendLoading?: boolean }>) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [enabledExtensions, setEnabledExtensions] = useState<string[]>([]);
  const [contributions, setContributions] = useState<ExtensionContribution[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);

  const registerContribution = useCallback(
    (contribution: ExtensionContribution) => {
      setContributions((prev) => {
        if (prev.some((c) => c.id === contribution.id)) return prev;
        return [...prev, contribution];
      });
    },
    [],
  );

  const loadExtensions = useCallback(async () => {
    if (isTauriRuntime()) {
      setExtensions([]);
      setEnabledExtensions([]);
      setContributions([]);
      setIsLoading(false);
      return;
    }

    try {
      const [extRes, setsRes] = await Promise.all([
        fetch("/api/extensions"),
        fetch("/api/settings"),
      ]);

      if (!extRes.ok || !setsRes.ok)
        throw new Error("Failed to fetch extensions or settings");

      const allExtensions: Extension[] = await extRes.json();
      const settings = await setsRes.json();
      const enabledIds =
        settings.enabledExtensions || allExtensions.map((e) => e.manifest.id);

      setExtensions(allExtensions);
      setEnabledExtensions(enabledIds);

      // Clear previous contributions before reloading
      setContributions([]);

      // Get auth token for URL-based loading (scripts, iframes)
      const token = getActiveToken("local");
      const authSuffix = token ? `?t=${encodeURIComponent(token)}` : "";

      // Load extensions based on entry type
      for (const ext of allExtensions) {
        if (!enabledIds.includes(ext.manifest.id)) continue;

        const entry = ext.manifest.entry;
        const entryUrl = `${globalThis.location.origin}/api/extensions/${ext.manifest.id}/${entry}${authSuffix}`;

        if (entry.endsWith(".html")) {
          // Automatically register a route for HTML-based extensions
          const path = `/ext/${ext.manifest.id}`;
          registerContribution({
            id: `auto-route-${ext.manifest.id}`,
            type: "route",
            path,
            component: ExtensionIframe,
            componentProps: { src: entryUrl, title: ext.manifest.name },
          });

          // Also register a nav item if it's a "main" extension
          registerContribution({
            id: `auto-nav-${ext.manifest.id}`,
            type: "nav",
            label: ext.manifest.name,
            path,
            component: ExtensionNavIcon,
          });
        } else {
          // Load as JS module
          const script = document.createElement("script");
          script.src = entryUrl;
          script.type = "module";
          script.async = true;
          document.head.appendChild(script);
        }
      }
    } catch (error) {
      console.error("Error loading extensions:", error);
    } finally {
      setIsLoading(false);
    }
  }, [registerContribution]);

  const loadExtensionsMetadata = useCallback(async () => {
    if (isTauriRuntime()) {
      setExtensions([]);
      setEnabledExtensions([]);
      setContributions([]);
      setIsLoading(false);
      return;
    }

    try {
      const [extRes, setsRes] = await Promise.all([
        fetch("/api/extensions"),
        fetch("/api/settings"),
      ]);

      if (!extRes.ok || !setsRes.ok)
        throw new Error("Failed to fetch extensions or settings");

      const allExtensions: Extension[] = await extRes.json();
      const settings = await setsRes.json();
      const enabledIds =
        settings.enabledExtensions || allExtensions.map((e) => e.manifest.id);

      setExtensions(allExtensions);
      setEnabledExtensions(enabledIds);
      setContributions([]);
    } catch (error) {
      console.error("Error loading extension metadata:", error);
      setExtensions([]);
      setEnabledExtensions([]);
      setContributions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const toggleExtension = useCallback(
    async (id: string, enabled: boolean) => {
      if (isTauriRuntime()) {
        return;
      }

      try {
        const newEnabled = enabled
          ? [...enabledExtensions, id]
          : enabledExtensions.filter((eid) => eid !== id);

        // Update settings on server
        const setsRes = await fetch("/api/settings");
        if (!setsRes.ok) return;
        const currentSettings = await setsRes.json();

        await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...currentSettings,
            enabledExtensions: newEnabled,
          }),
        });

        // We need a full page reload or a way to "unload" scripts to properly toggle
        // For now, we update local state and let the user know a reload might be needed
        // or we just reload the extension list which will re-register contributions.
        // NOTE: JS scripts already in head won't be removed, but nav/routes will be updated.
        setEnabledExtensions(newEnabled);
        globalThis.location.reload(); // Simplest way to ensure "unloading" of JS extensions
      } catch (e) {
        console.error("Failed to toggle extension", e);
      }
    },
    [enabledExtensions],
  );

  useEffect(() => {
    if (isTauriRuntime()) {
      setExtensions([]);
      setEnabledExtensions([]);
      setContributions([]);
      setIsLoading(false);
      return;
    }

    if (suspendLoading) {
      void loadExtensionsMetadata();
      return;
    }

    // Expose Global API for extensions
    (globalThis as any).NSV = {
      registerContribution,
      // Ecosystem: Intercept chat messages
      onChatMessage: (callback: (msg: any) => void) => {
        const handler = (event: any) => callback(event.detail);
        globalThis.addEventListener("nsv-chat-message", handler);
        return () =>
          globalThis.removeEventListener("nsv-chat-message", handler);
      },
      // Ecosystem: Inject global CSS
      injectCSS: (css: string) => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
        return () => style.remove();
      },
      // Ecosystem: Custom actions (like Clip It)
      registerAction: (id: string, callback: (payload: any) => void) => {
        const handler = (event: any) => {
          if (event.detail?.id === id) callback(event.detail.payload);
        };
        globalThis.addEventListener("nsv-action", handler);
        return () => globalThis.removeEventListener("nsv-action", handler);
      },
      // Specific Clip It API
      clipCurrentVod: async (
        vodId: string,
        startTime: number,
        endTime: number,
        title?: string,
      ) => {
        return fetch("/api/download/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vodId,
            title: title || `Clip ${vodId}`,
            quality: "best",
            startTime,
            endTime,
          }),
        });
      },
    };

    loadExtensions();
  }, [
    loadExtensions,
    loadExtensionsMetadata,
    registerContribution,
    suspendLoading,
  ]);

  const contextValue = useMemo(
    () => ({
      extensions,
      enabledExtensions,
      contributions,
      registerContribution,
      toggleExtension,
      isLoading,
    }),
    [
      extensions,
      enabledExtensions,
      contributions,
      registerContribution,
      toggleExtension,
      isLoading,
    ],
  );

  return (
    <ExtensionContext.Provider value={contextValue}>
      {children}
    </ExtensionContext.Provider>
  );
}

export const useExtensions = () => {
  const context = useContext(ExtensionContext);
  if (!context) {
    throw new Error("useExtensions must be used within an ExtensionProvider");
  }
  return context;
};
