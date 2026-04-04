import React, {
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useEffect,
  useState,
} from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
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

function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleNotification = useCallback(
    (event: { payload: { title: string; message: string } }) => {
      const id = Math.random().toString(36).substring(7);
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
              <div className="status-line" style={{ padding: "24px 16px" }}>
                Loading portal...
              </div>
            }
          >
            <div className="content-wrap">
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
