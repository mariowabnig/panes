// ── Rust → Node (commands) ───────────────────────────────────────────

export interface QueryRequest {
  id: string;
  method: "query";
  params: {
    prompt: string;
    attachments?: Array<{
      fileName: string;
      filePath: string;
      sizeBytes: number;
      mimeType: string;
    }>;
    cwd: string;
    model: string;
    sessionId?: string;
    resume?: string;
    approvalPolicy?: string;
    allowNetwork?: boolean;
    writableRoots?: string[];
    sandboxMode?: string;
    reasoningEffort?: string;
    planMode?: boolean;
  };
}

export interface CancelRequest {
  method: "cancel";
  params: { requestId: string };
}

export interface ApprovalResponseRequest {
  method: "approval_response";
  params: {
    approvalId: string;
    response: { decision: "accept" | "decline" | "accept_for_session" };
  };
}

export type SidecarRequest = QueryRequest | CancelRequest | ApprovalResponseRequest;

// ── Node → Rust (flat NDJSON events) ────────────────────────────────
// These must be top-level objects with a `type` field matching the Rust
// `SidecarEvent` enum variants (snake_case).

export interface ReadyEvent {
  type: "ready";
}

export interface SessionInitEvent {
  type: "session_init";
  id: string;
  sessionId: string;
}

export interface TurnStartedEvent {
  type: "turn_started";
  id: string;
}

export interface TextDeltaEvent {
  type: "text_delta";
  id: string;
  content: string;
}

export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  id: string;
  content: string;
}

export interface ActionStartedEvent {
  type: "action_started";
  id: string;
  actionId: string;
  actionType: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface ActionOutputDeltaEvent {
  type: "action_output_delta";
  id: string;
  actionId: string;
  stream: "stdout" | "stderr";
  content: string;
}

export interface ActionProgressUpdatedEvent {
  type: "action_progress_updated";
  id: string;
  actionId: string;
  message: string;
}

export interface ActionCompletedEvent {
  type: "action_completed";
  id: string;
  actionId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs?: number;
}

export interface ApprovalRequestedEvent {
  type: "approval_requested";
  id: string;
  approvalId: string;
  actionType: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface TurnCompletedEvent {
  type: "turn_completed";
  id: string;
  status: "completed" | "interrupted" | "failed";
  sessionId?: string;
  tokenUsage?: { input: number; output: number };
  stopReason?: string;
}

export interface NoticeEvent {
  type: "notice";
  id?: string;
  kind: string;
  level: "info" | "warning" | "error";
  title: string;
  message: string;
}

export interface ErrorEvent {
  type: "error";
  id?: string;
  message: string;
  recoverable?: boolean;
  errorType?: string;
  isAuthError?: boolean;
}

export interface VersionEvent {
  type: "version";
  id?: string;
  version: string;
}

export type SidecarEvent =
  | ReadyEvent
  | SessionInitEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ActionStartedEvent
  | ActionOutputDeltaEvent
  | ActionProgressUpdatedEvent
  | ActionCompletedEvent
  | ApprovalRequestedEvent
  | TurnCompletedEvent
  | NoticeEvent
  | ErrorEvent
  | VersionEvent;
