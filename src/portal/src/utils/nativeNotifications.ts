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

function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

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

export async function canSendNativeNotification(): Promise<boolean> {
  const api = await getPluginApi();
  if (!api) {
    return false;
  }

  if (permissionState === "granted") {
    return true;
  }

  try {
    const granted = await api.isPermissionGranted();
    permissionState = granted ? "granted" : "denied";
    return granted;
  } catch {
    permissionState = "denied";
    return false;
  }
}

export async function sendNativeNotification(
  title: string,
  message: string,
): Promise<void> {
  const api = await getPluginApi();
  if (!api) {
    return;
  }

  const canNotify = await canSendNativeNotification();
  if (!canNotify) {
    return;
  }

  try {
    await api.sendNotification({
      title,
      body: message,
    });
  } catch {
    // Ignore native notification failures to keep UI responsive.
  }
}
