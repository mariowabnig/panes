export type PanesUnlistenFn = () => void;

export interface PanesTransport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(channel: string, onEvent: (payload: T) => void): Promise<PanesUnlistenFn>;
}

let activeTransport: PanesTransport | null = null;

export function setPanesTransport(transport: PanesTransport): void {
  activeTransport = transport;
}

export function resetPanesTransport(): void {
  activeTransport = null;
}

export function getPanesTransport(): PanesTransport {
  if (!activeTransport) {
    throw new Error(
      "Panes transport is not configured. Set a desktop or remote transport before calling ipc.",
    );
  }
  return activeTransport;
}
