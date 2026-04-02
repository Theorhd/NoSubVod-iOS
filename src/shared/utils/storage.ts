export const safeStorageGet = (
  storage: Storage,
  key: string,
  defaultValue: string = ''
): string => {
  try {
    const item = storage.getItem(key);
    return item ?? defaultValue;
  } catch {
    console.warn(`Failed to access storage for key: ${key}`);
    return defaultValue;
  }
};

export const safeStorageSet = (storage: Storage, key: string, value: string): void => {
  try {
    storage.setItem(key, value);
  } catch {
    console.warn(`Failed to set storage for key: ${key}`);
  }
};
