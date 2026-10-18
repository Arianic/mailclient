import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const nativeDesktop = isTauri();
if (nativeDesktop) document.documentElement.dataset.native = "true";

export async function windowAction(action: "close" | "minimize" | "maximize") {
  if (!nativeDesktop) return;
  const window = getCurrentWindow();
  if (action === "close") await window.close();
  if (action === "minimize") await window.minimize();
  if (action === "maximize") await window.toggleMaximize();
}

export async function openNativeComposer(draftId: string) {
  await invoke("open_compose", { draftId });
}

export async function quitDesktop() {
  await invoke("quit_app");
}

export function dragNativeWindow(event: React.MouseEvent<HTMLElement>) {
  if (!nativeDesktop || event.button !== 0) return;
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("button,input,select,textarea,a")) return;
  void getCurrentWindow().startDragging().catch(console.error);
}
