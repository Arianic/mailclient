import { useMemo, useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  WorkspaceStore,
  type Snapshot,
  type WorkspaceUpdate,
} from "./workspace-store";

export const storage = new WorkspaceStore(
  isTauri()
    ? {
        load: () => invoke<Snapshot>("load_workspace"),
        set: (key, value) =>
          invoke<WorkspaceUpdate>("store_value", { key, value }),
        remove: (key) => invoke<WorkspaceUpdate>("remove_value", { key }),
        listen: (callback) =>
          listen<WorkspaceUpdate>("workspace-updated", (event) =>
            callback(event.payload),
          ),
      }
    : undefined,
);

export function useStored<T>(key: string, fallback: T) {
  const raw = useSyncExternalStore(storage.subscribe, () =>
    storage.getItem(key),
  );
  const value = useMemo<T>(() => {
    try {
      return JSON.parse(raw || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);
  const setValue = (update: T | ((current: T) => T)) => {
    let current: T;
    try {
      current = JSON.parse(storage.getItem(key) || "null") ?? fallback;
    } catch {
      current = fallback;
    }
    const next =
      typeof update === "function"
        ? (update as (current: T) => T)(current)
        : update;
    storage.setItem(key, JSON.stringify(next));
  };
  return [value, setValue] as const;
}

export function StorageNotice() {
  const error = useSyncExternalStore(storage.subscribe, () => storage.error);
  return error ? (
    <div className="storage-error" role="alert">
      {error}
      <button onClick={() => void storage.flush().catch(() => {})}>
        Retry saving
      </button>
    </div>
  ) : null;
}
