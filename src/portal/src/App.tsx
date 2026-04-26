import React, {
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  TrendingUp,
  Home as HomeIcon,
  Search as SearchIcon,
  Radio,
  Download,
  MonitorSmartphone,
  Bell,
  X,
} from "lucide-react";
import { ErrorBoundary } from "../../shared/components/ErrorBoundary";
import { ServerProvider, useServer } from "./ServerContext";
import { ExtensionProvider, useExtensions } from "./ExtensionContext";
import { navigateBackInApp } from "./utils/navigation";
import "./styles/App.css";

const Home = lazy(() => import("./Home"));
const Channel = lazy(() => import("./Channel"));
const Player = lazy(() => import("./Player"));
const Trends = lazy(() => import("./Trends"));
const Search = lazy(() => import("./Search"));
const Live = lazy(() => import("./Live"));
const Settings = lazy(() => import("./Settings"));
const History = lazy(() => import("./History"));
const Downloads = lazy(() => import("./Downloads"));
const MultiView = lazy(() => import("./MultiView"));
const ScreenShare = lazy(() => import("./ScreenShare.tsx"));

const SUSPEND_EXTENSION_LOADING = true;
const APP_READY_EVENT_NAME = "nsv-app-ready";

type NavItem = {
  path: string;
  label: string;
  Icon: React.ComponentType<any>;
  IconProps?: any;
  isHome?: boolean;
};

type Notification = {
  id: string;
  title: string;
  message: string;
};

function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

function isIosTouchRuntime(): boolean {
  if (!isTauriRuntime()) {
    return false;
  }

  const ua = globalThis.navigator.userAgent.toLowerCase();
  return (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    (ua.includes("macintosh") && "ontouchend" in document)
  );
}

function isSwipeBackBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, button, [contenteditable='true'], [data-disable-swipe-back='true']",
    ),
  );
}

function AppReadySignal() {
  const hasEmittedRef = useRef(false);

  useEffect(() => {
    if (hasEmittedRef.current) {
      return;
    }

    hasEmittedRef.current = true;
    const frame = globalThis.requestAnimationFrame(() => {
      globalThis.dispatchEvent(new Event(APP_READY_EVENT_NAME));
    });

    return () => {
      globalThis.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}

function IosSwipeBackBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const swipeStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startedAt: 0,
  });
  const lastBackAtRef = useRef(0);

  useEffect(() => {
    if (!isIosTouchRuntime()) {
      return;
    }

    const EDGE_TRIGGER_PX = 28;
    const MIN_HORIZONTAL_DISTANCE_PX = 76;
    const MAX_VERTICAL_DRIFT_PX = 88;
    const MAX_GESTURE_DURATION_MS = 900;
    const BACK_GESTURE_COOLDOWN_MS = 450;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        swipeStateRef.current.active = false;
        return;
      }

      const touch = event.touches[0];
      const fromLeftEdge = touch.clientX <= EDGE_TRIGGER_PX;

      if (!fromLeftEdge || isSwipeBackBlockedTarget(event.target)) {
        swipeStateRef.current.active = false;
        return;
      }

      swipeStateRef.current = {
        active: true,
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: Date.now(),
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!swipeStateRef.current.active || event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      const deltaX = touch.clientX - swipeStateRef.current.startX;
      const deltaY = Math.abs(touch.clientY - swipeStateRef.current.startY);

      if (deltaY > MAX_VERTICAL_DRIFT_PX || deltaX < -8) {
        swipeStateRef.current.active = false;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!swipeStateRef.current.active || event.changedTouches.length < 1) {
        swipeStateRef.current.active = false;
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - swipeStateRef.current.startX;
      const deltaY = Math.abs(touch.clientY - swipeStateRef.current.startY);
      const durationMs = Date.now() - swipeStateRef.current.startedAt;
      swipeStateRef.current.active = false;

      if (deltaX < MIN_HORIZONTAL_DISTANCE_PX) {
        return;
      }

      if (deltaY > MAX_VERTICAL_DRIFT_PX) {
        return;
      }

      if (durationMs > MAX_GESTURE_DURATION_MS) {
        return;
      }

      const now = Date.now();
      if (now - lastBackAtRef.current < BACK_GESTURE_COOLDOWN_MS) {
        return;
      }

      lastBackAtRef.current = now;
      navigateBackInApp(navigate, "/");
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [location.pathname, navigate]);

  return null;
}

const NotificationToast = ({
  notifications,
  onClose,
}: {
  notifications: Notification[];
  onClose: (id: string) => void;
}) => {
  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <div key={n.id} className="toast">
          <div className="toast-icon">
            <Bell size={18} />
          </div>
          <div className="toast-content">
            <div className="toast-title">{n.title}</div>
            <div className="toast-msg">{n.message}</div>
          </div>
          <button className="toast-close" onClick={() => onClose(n.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

const MemoNotificationToast = React.memo(NotificationToast);

function createNotificationId(): string {
  const api = globalThis.crypto;
  if (api?.randomUUID) {
    return api.randomUUID().replaceAll("-", "");
  }
  if (api?.getRandomValues) {
    const bytes = new Uint8Array(10);
    api.getRandomValues(bytes);
    let hex = "";
    for (const byte of bytes) {
      const b = byte.toString(16);
      hex += b.length === 1 ? `0${b}` : b;
    }
    return hex;
  }
  return `${Date.now().toString(36)}-${(globalThis.performance?.now() ?? 0)
    .toString(36)
    .replace(".", "")}`;
}

function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleNotification = useCallback(
    (event: { payload: { title: string; message: string } }) => {
      const id = createNotificationId();
      const newNotif = { id, ...event.payload };
      setNotifications((prev) => [...prev, newNotif]);
      globalThis.setTimeout(() => removeNotification(id), 5000);
    },
    [removeNotification],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      if (!isTauriRuntime()) return;
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ title: string; message: string }>(
        "nsv-notification",
        handleNotification,
      );
    };

    void setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleNotification]);

  return (
    <MemoNotificationToast
      notifications={notifications}
      onClose={removeNotification}
    />
  );
}

const BottomNav = React.memo(({ items }: Readonly<{ items: NavItem[] }>) => {
  const location = useLocation();
  const navigate = useNavigate();
  const hiddenRoutes = ["/player", "/channel"];

  if (hiddenRoutes.some((r) => location.pathname.startsWith(r))) {
    return null;
  }

  return (
    <nav
      className={`bottom-nav nav-count-${items.length}`}
      aria-label="Main Navigation"
    >
      {items.map((item) => {
        const isActive =
          item.path === "/"
            ? location.pathname === "/"
            : location.pathname === item.path;
        return (
          <button
            key={item.path}
            className={`nav-btn ${isActive ? "active" : ""} ${item.isHome ? "nav-home-btn" : ""}`}
            onClick={() => navigate(item.path)}
            type="button"
          >
            <item.Icon size={item.isHome ? 28 : 22} {...item.IconProps} />
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
});

BottomNav.displayName = "BottomNav";

function AppContent() {
  const { isConnected: isServerConnected, serverUrl } = useServer();
  const { contributions } = useExtensions();
  const isDesktopConnected = isServerConnected && Boolean(serverUrl);

  useEffect(() => {
    try {
      const currentUrl = new URL(globalThis.location.href);
      const queryToken = currentUrl.searchParams.get("t")?.trim();
      if (!queryToken) return;

      currentUrl.searchParams.delete("t");
      const cleanUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      globalThis.history.replaceState({}, "", cleanUrl || "/");
    } catch {
      // Ignore
    }
  }, []);

  const navItems: NavItem[] = useMemo(
    () => [
      { path: "/trends", label: "Trends", Icon: TrendingUp },
      { path: "/live", label: "Live", Icon: Radio },
      { path: "/", label: "Home", Icon: HomeIcon, isHome: true },
      ...(isDesktopConnected
        ? [
            {
              path: "/screen-share",
              label: "Screen Share",
              Icon: MonitorSmartphone,
            },
          ]
        : []),
      { path: "/search", label: "Search", Icon: SearchIcon },
      { path: "/downloads", label: "Downloads", Icon: Download },
      // Contribution Nav Items
      ...contributions
        .filter((c) => c.type === "nav")
        .map((c) => ({
          path: c.path || "",
          label: c.label || "",
          Icon: c.component,
          IconProps: c.componentProps,
        })),
    ],
    [contributions, isDesktopConnected],
  );

  return (
    <Router>
      <ErrorBoundary>
        <div className="app-container">
          <Suspense
            fallback={
              <div className="status-line portal-loader">
                Loading portal...
              </div>
            }
          >
            <AppReadySignal />
            <div className="content-wrap">
              <IosSwipeBackBridge />
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/trends" element={<Trends />} />
                <Route path="/live" element={<Live />} />
                <Route path="/search" element={<Search />} />
                <Route path="/player" Component={Player} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/channel" element={<Channel />} />
                <Route path="/multi-view" element={<MultiView />} />
                <Route path="/downloads" element={<Downloads />} />
                <Route path="/screen-share" element={<ScreenShare />} />
                {/* Contribution Routes */}
                {contributions
                  .filter((c) => c.type === "route")
                  .map((c) => (
                    <Route
                      key={c.id}
                      path={c.path}
                      element={<c.component {...c.componentProps} />}
                    />
                  ))}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Suspense>
          <BottomNav items={navItems} />
          <NotificationCenter />
        </div>
      </ErrorBoundary>
    </Router>
  );
}

export default function App() {
  return (
    <ServerProvider>
      <ExtensionProvider suspendLoading={SUSPEND_EXTENSION_LOADING}>
        <AppContent />
      </ExtensionProvider>
    </ServerProvider>
  );
}
