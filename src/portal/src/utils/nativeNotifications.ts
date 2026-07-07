import { isTauriRuntime } from "./capabilities";

type NotificationPluginApi = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<"granted" | "denied" | "default">;
  sendNotification: (options: {
    title: string;
    body: string;
  }) => void | Promise<void>;
};

type PermissionState = "unknown" | "granted" | "denied";

let pluginApiPromise: Promise<NotificationPluginApi | null> | null = null;
let permissionState: PermissionState = "unknown";

async function getPluginApi(): Promise<NotificationPluginApi | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  if (!pluginApiPromise) {
    pluginApiPromise = import("@tauri-apps/plugin-notification")
      .then((module) => ({
        isPermissionGranted: module.isPermissionGranted,
        requestPermission: module.requestPermission,
        sendNotification: module.sendNotification,
      }))
      .catch(() => null);
  }

  return pluginApiPromise;
}

export async function ensureNativeNotificationPermission(): Promise<boolean> {
  const api = await getPluginApi();
  if (!api) {
    return false;
  }

  if (permissionState === "granted") {
    return true;
  }
  if (permissionState === "denied") {
    return false;
  }

  try {
    const alreadyGranted = await api.isPermissionGranted();
    if (alreadyGranted) {
      permissionState = "granted";
      return true;
    }

    const requested = await api.requestPermission();
    const granted = requested === "granted";
    permissionState = granted ? "granted" : "denied";
    return granted;
  } catch {
    permissionState = "denied";
    return false;
  }
}
