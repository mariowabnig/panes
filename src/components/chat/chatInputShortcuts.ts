interface ChatInputShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

export function shouldSubmitChatInput(
  event: ChatInputShortcutEvent,
  enterToSend?: boolean,
): boolean {
  if (event.isComposing || event.key !== "Enter") {
    return false;
  }

  if (enterToSend) {
    // Plain Enter submits; Shift+Enter inserts newline
    return !event.shiftKey;
  }

  return event.shiftKey || event.ctrlKey || event.metaKey;
}
