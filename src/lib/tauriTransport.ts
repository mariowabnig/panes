import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PanesTransport } from "./panesTransport";

export function createTauriTransport(): PanesTransport {
  return {
    invoke: (command, args) => invoke(command, args),
    listen: (channel, onEvent) =>
      listen(channel, ({ payload }) => onEvent(payload as Parameters<typeof onEvent>[0])),
  };
}
