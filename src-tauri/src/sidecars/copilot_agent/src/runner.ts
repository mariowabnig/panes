import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type {
  QueryRequest,
  SidecarEvent,
} from "./protocol.js";

const execFileAsync = promisify(execFile);

// ── Copilot token management ─────────────────────────────────────────

interface CopilotToken {
  token: string;
  expiresAt: number; // unix ms
}

let cachedCopilotToken: CopilotToken | null = null;

// VS Code Copilot OAuth client ID — used for device flow auth
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

// Persistent OAuth token from device flow (survives across Copilot token refreshes)
let cachedOAuthToken: string | null = null;

async function getGitHubToken(): Promise<string> {
  // If we already completed device flow, reuse that token
  if (cachedOAuthToken) return cachedOAuthToken;

  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: 5_000,
    });
    const token = stdout.trim();
    if (!token) throw new Error("gh auth token returned empty");
    return token;
  } catch {
    throw new Error(
      "GitHub CLI not authenticated. Run `gh auth login` first.",
    );
  }
}

async function tryExchangeForCopilotToken(
  ghToken: string,
): Promise<CopilotToken | null> {
  const response = await fetch(
    "https://api.github.com/copilot_internal/v2/token",
    {
      headers: {
        Authorization: `token ${ghToken}`,
        Accept: "application/json",
        "User-Agent": "Panes-CopilotAgent/1.0",
        "Editor-Version": "Panes/1.0",
      },
    },
  );

  if (response.status === 404) {
    // Token lacks copilot scope — need device flow
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(
        new Error(
          `Copilot authentication failed (${response.status}). Ensure you have an active GitHub Copilot subscription. ${body}`,
        ),
        { isAuthError: true },
      );
    }
    throw new Error(
      `Failed to get Copilot token: ${response.status} ${body}`,
    );
  }

  const data = (await response.json()) as {
    token: string;
    expires_at: number;
  };

  return {
    token: data.token,
    expiresAt: data.expires_at * 1000,
  };
}

async function deviceFlowAuth(
  emit: (event: SidecarEvent) => void,
): Promise<string> {
  // Step 1: Request device code
  const codeResponse = await fetch(
    "https://github.com/login/device/code",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        scope: "read:user",
      }),
    },
  );

  if (!codeResponse.ok) {
    throw new Error(
      `Device flow initiation failed: ${codeResponse.status}`,
    );
  }

  const codeData = (await codeResponse.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  // Notify the user via a notice event to open the verification URL
  emit({
    type: "notice",
    kind: "copilot_device_flow",
    level: "info",
    title: "GitHub Copilot Sign In",
    message: `Open ${codeData.verification_uri} and enter code: ${codeData.user_code}`,
  });

  // Step 2: Poll for authorization
  const interval = (codeData.interval || 5) * 1000;
  const deadline = Date.now() + codeData.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: COPILOT_CLIENT_ID,
          device_code: codeData.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenData.access_token) {
      cachedOAuthToken = tokenData.access_token;
      return tokenData.access_token;
    }

    if (
      tokenData.error === "authorization_pending" ||
      tokenData.error === "slow_down"
    ) {
      continue;
    }

    throw new Error(
      `Device flow failed: ${tokenData.error ?? "unknown error"}`,
    );
  }

  throw Object.assign(
    new Error("Device flow timed out — user did not authorize in time"),
    { isAuthError: true },
  );
}

async function getCopilotToken(
  emit: (event: SidecarEvent) => void,
): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedCopilotToken && cachedCopilotToken.expiresAt > Date.now() + 60_000) {
    return cachedCopilotToken.token;
  }

  // Try gh CLI token first
  const ghToken = await getGitHubToken();
  const directResult = await tryExchangeForCopilotToken(ghToken);

  if (directResult) {
    cachedCopilotToken = directResult;
    return directResult.token;
  }

  // gh token lacks copilot scope — fall back to device flow
  const oauthToken = await deviceFlowAuth(emit);
  const deviceResult = await tryExchangeForCopilotToken(oauthToken);

  if (!deviceResult) {
    throw Object.assign(
      new Error(
        "Copilot token exchange failed after device flow auth. Ensure you have an active GitHub Copilot subscription.",
      ),
      { isAuthError: true },
    );
  }

  cachedCopilotToken = deviceResult;
  return deviceResult.token;
}

// ── Active request tracking (for cancellation) ──────────────────────

const activeRequests = new Map<string, AbortController>();

export function handleCancel(requestId: string): void {
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
  }
}

// ── Approval handling ───────────────────────────────────────────────

type ApprovalDecision = "accept" | "decline" | "accept_for_session";
type ApprovalResolver = (decision: ApprovalDecision) => void;
const pendingApprovals = new Map<string, ApprovalResolver>();

export function handleApprovalResponse(
  approvalId: string,
  decision: ApprovalDecision,
): void {
  const resolver = pendingApprovals.get(approvalId);
  if (resolver) {
    resolver(decision);
    pendingApprovals.delete(approvalId);
  }
}

function waitForApproval(
  approvalId: string,
  signal: AbortSignal,
): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Approval wait aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      pendingApprovals.delete(approvalId);
      reject(new DOMException("Approval wait aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    pendingApprovals.set(approvalId, (decision) => {
      signal.removeEventListener("abort", onAbort);
      resolve(decision);
    });
  });
}

// ── Conversation history ────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const sessionHistory = new Map<string, ChatMessage[]>();

// ── Tool definitions for agentic mode ───────────────────────────────

const COPILOT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "file_read",
      description: "Read the contents of a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "file_write",
      description: "Write content to a file (creates or overwrites)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path to write" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "file_edit",
      description:
        "Replace a specific string in a file. The old_string must be unique within the file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path" },
          old_string: { type: "string", description: "Exact text to find" },
          new_string: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "command",
      description: "Execute a shell command and return its output",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          cwd: {
            type: "string",
            description: "Working directory (defaults to project root)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search",
      description: "Search for files or content using glob/grep patterns",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern" },
          path: {
            type: "string",
            description: "Directory to search in",
          },
          type: {
            type: "string",
            enum: ["glob", "grep"],
            description: "Search type: glob for filenames, grep for content",
          },
        },
        required: ["pattern"],
      },
    },
  },
];

// ── Sandbox enforcement ──────────────────────────────────────────────

import { resolve as pathResolve } from "node:path";
import { realpath as fsRealpath } from "node:fs/promises";

interface SandboxConstraints {
  sandboxMode?: string;
  writableRoots?: string[];
  allowNetwork?: boolean;
}

async function checkSandbox(
  toolName: string,
  args: Record<string, string>,
  cwd: string,
  sandbox: SandboxConstraints,
): Promise<string | null> {
  const { sandboxMode, writableRoots } = sandbox;

  // read-only mode: block all writes and commands
  if (sandboxMode === "read-only") {
    if (
      toolName === "file_write" ||
      toolName === "file_edit" ||
      toolName === "file_delete" ||
      toolName === "command"
    ) {
      return `Blocked by sandbox: "${toolName}" is not allowed in read-only mode`;
    }
  }

  // workspace-write mode: only allow writes within writable roots
  if (sandboxMode === "workspace-write") {
    if (toolName === "command") {
      return `Blocked by sandbox: shell commands are not allowed in workspace-write mode`;
    }

    if (
      toolName === "file_write" ||
      toolName === "file_edit" ||
      toolName === "file_delete"
    ) {
      // Resolve symlinks to prevent sandbox escapes via symlinked paths
      let targetPath: string;
      try {
        // Try to resolve the real path (follows symlinks)
        targetPath = await fsRealpath(pathResolve(cwd, args.path));
      } catch {
        // File doesn't exist yet (new file) — resolve lexically
        // For new files, resolve the parent directory to catch symlinked dirs
        const parentDir = pathResolve(cwd, args.path, "..");
        try {
          const realParent = await fsRealpath(parentDir);
          const basename = pathResolve(cwd, args.path).split("/").pop()!;
          targetPath = pathResolve(realParent, basename);
        } catch {
          // Parent doesn't exist either — use lexical resolution
          targetPath = pathResolve(cwd, args.path);
        }
      }

      const roots = writableRoots ?? [cwd];
      let allowed = false;
      for (const root of roots) {
        let resolvedRoot: string;
        try {
          resolvedRoot = await fsRealpath(root);
        } catch {
          resolvedRoot = pathResolve(root);
        }
        if (
          targetPath === resolvedRoot ||
          targetPath.startsWith(resolvedRoot + "/")
        ) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return `Blocked by sandbox: "${args.path}" resolves outside writable roots`;
      }
    }
  }

  return null;
}

// ── Tool execution ──────────────────────────────────────────────────

import { readFile, writeFile } from "node:fs/promises";

async function executeTool(
  name: string,
  args: Record<string, string>,
  cwd: string,
): Promise<{ success: boolean; output?: string; error?: string }> {
  const startMs = Date.now();
  try {
    switch (name) {
      case "file_read": {
        const content = await readFile(args.path, "utf-8");
        return { success: true, output: content };
      }
      case "file_write": {
        await writeFile(args.path, args.content, "utf-8");
        return { success: true, output: `Wrote ${args.content.length} bytes to ${args.path}` };
      }
      case "file_edit": {
        const fileContent = await readFile(args.path, "utf-8");
        if (!fileContent.includes(args.old_string)) {
          return {
            success: false,
            error: `old_string not found in ${args.path}`,
          };
        }
        const newContent = fileContent.replace(args.old_string, args.new_string);
        await writeFile(args.path, newContent, "utf-8");
        return { success: true, output: `Edited ${args.path}` };
      }
      case "command": {
        const { stdout, stderr } = await execFileAsync(
          "bash",
          ["-c", args.command],
          {
            cwd: args.cwd || cwd,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          },
        );
        const combined = [stdout, stderr].filter(Boolean).join("\n");
        return { success: true, output: combined || "(no output)" };
      }
      case "search": {
        const searchType = args.type || "grep";
        const searchPath = args.path || cwd;
        let stdout: string;
        if (searchType === "glob") {
          // Use find with safe argument passing — no shell interpolation
          const result = await execFileAsync(
            "find",
            [searchPath, "-name", args.pattern, "-type", "f"],
            { cwd, timeout: 15_000, maxBuffer: 1024 * 1024 },
          );
          // Limit output to 50 lines
          stdout = result.stdout.split("\n").slice(0, 50).join("\n");
        } else {
          // Use grep with safe argument passing — no shell interpolation
          const result = await execFileAsync(
            "grep",
            ["-rn", "--include=*", args.pattern, searchPath],
            { cwd, timeout: 15_000, maxBuffer: 1024 * 1024 },
          );
          stdout = result.stdout.split("\n").slice(0, 50).join("\n");
        }
        return { success: true, output: stdout || "(no matches)" };
      }
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Streaming chat completion ───────────────────────────────────────

interface SSEDelta {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface SSEChoice {
  index: number;
  delta: SSEDelta;
  finish_reason: string | null;
}

async function* streamCopilotChat(
  messages: ChatMessage[],
  model: string,
  requestId: string,
  signal: AbortSignal,
  emit: (event: SidecarEvent) => void,
): AsyncGenerator<
  | { kind: "content"; text: string }
  | { kind: "tool_calls"; calls: ToolCall[] }
  | { kind: "done"; usage?: { input: number; output: number } }
> {
  const copilotToken = await getCopilotToken(emit);

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: 0.1,
    tools: COPILOT_TOOLS,
    tool_choice: "auto",
  };

  const response = await fetch(
    "https://api.githubcopilot.com/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Copilot-Integration-Id": "panes-editor",
        "Editor-Version": "Panes/1.0",
        "User-Agent": "Panes-CopilotAgent/1.0",
        "Openai-Intent": "conversation-panel",
      },
      body: JSON.stringify(body),
      signal,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      // Invalidate cached token so next attempt re-auths
      cachedCopilotToken = null;
      throw Object.assign(
        new Error(
          `Copilot authentication failed (${response.status}). Sign in again or check your subscription. ${errorBody}`,
        ),
        { isAuthError: true },
      );
    }
    if (response.status === 429) {
      throw new Error(
        `Copilot rate limit exceeded. Please wait a moment and try again. ${errorBody}`,
      );
    }
    throw new Error(
      `Copilot API error: ${response.status} ${errorBody}`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from Copilot API");

  const decoder = new TextDecoder();
  let buffer = "";
  const pendingToolCalls: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();
  let usage: { input: number; output: number } | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        // Flush any accumulated tool calls
        if (pendingToolCalls.size > 0) {
          const calls: ToolCall[] = [];
          for (const [, tc] of pendingToolCalls) {
            calls.push({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            });
          }
          pendingToolCalls.clear();
          yield { kind: "tool_calls", calls };
        }
        yield { kind: "done", usage };
        return;
      }

      let parsed: { choices?: SSEChoice[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (parsed.usage) {
        usage = {
          input: parsed.usage.prompt_tokens ?? 0,
          output: parsed.usage.completion_tokens ?? 0,
        };
      }

      const choice = parsed.choices?.[0];
      if (!choice) continue;

      // Stream text content
      if (choice.delta.content) {
        yield { kind: "content", text: choice.delta.content };
      }

      // Accumulate tool call deltas
      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const existing = pendingToolCalls.get(tc.index);
          if (!existing) {
            pendingToolCalls.set(tc.index, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
            });
          } else {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments)
              existing.arguments += tc.function.arguments;
          }
        }
      }

      // If finish_reason indicates tool use, flush
      if (choice.finish_reason === "tool_calls" && pendingToolCalls.size > 0) {
        const calls: ToolCall[] = [];
        for (const [, tc] of pendingToolCalls) {
          calls.push({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          });
        }
        pendingToolCalls.clear();
        yield { kind: "tool_calls", calls };
      }
    }
  }

  // Stream ended without [DONE] — still flush
  if (pendingToolCalls.size > 0) {
    const calls: ToolCall[] = [];
    for (const [, tc] of pendingToolCalls) {
      calls.push({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      });
    }
    yield { kind: "tool_calls", calls };
  }
  yield { kind: "done", usage };
}

// ── Model mapping ───────────────────────────────────────────────────
// Map Panes model IDs to Copilot-supported model identifiers.

function mapModel(paneModelId: string): string {
  const modelMap: Record<string, string> = {
    "claude-sonnet-4.5": "claude-3.5-sonnet",
    "claude-sonnet-4.6": "claude-3.5-sonnet",
    "claude-opus-4.6": "claude-3.5-sonnet",
    "claude-haiku-4.5": "claude-3.5-sonnet",
    "gpt-5.4": "gpt-4o",
    "gpt-5-mini": "gpt-4o-mini",
    "gpt-4.1": "gpt-4o",
    "gemini-2.5-pro": "gemini-2.0-flash",
    "grok-code-fast-1": "gpt-4o",
  };
  return modelMap[paneModelId] ?? "gpt-4o";
}

// ── System prompt ───────────────────────────────────────────────────

function buildSystemPrompt(cwd: string): string {
  return `You are an expert coding assistant integrated into Panes, an agentic terminal and AI workspace.

Working directory: ${cwd}

You have access to tools for reading, writing, and editing files, running shell commands, and searching the codebase. Use them proactively to help the user.

Guidelines:
- Read files before modifying them.
- Use file_edit for targeted changes; file_write for new files or full rewrites.
- Run commands to verify your changes (tests, linting, etc.).
- Be concise in your explanations. Lead with actions, not narration.
- When you need to explore the codebase, use the search tool.`;
}

// ── Main request handler ────────────────────────────────────────────

export async function* handleRequest(
  request: QueryRequest,
  _emit: (event: SidecarEvent) => void,
): AsyncGenerator<SidecarEvent> {
  const { id, params } = request;
  const {
    prompt,
    cwd,
    model: rawModel,
    sessionId,
    resume,
  } = params;

  const effectiveSessionId = resume ?? sessionId ?? id;
  const model = mapModel(rawModel);

  // Initialize or retrieve conversation history
  if (!sessionHistory.has(effectiveSessionId)) {
    sessionHistory.set(effectiveSessionId, [
      { role: "system", content: buildSystemPrompt(cwd) },
    ]);
  }
  const messages = sessionHistory.get(effectiveSessionId)!;

  // Track history length before this turn so we can rollback on failure
  const historyCheckpoint = messages.length;

  // Append user message
  messages.push({ role: "user", content: prompt });

  // Set up cancellation
  const abortController = new AbortController();
  activeRequests.set(id, abortController);

  let turnCommitted = false;

  try {
    // Emit session init if this is a new session
    if (!resume) {
      yield {
        type: "session_init",
        id,
        sessionId: effectiveSessionId,
      };
    }

    yield { type: "turn_started", id };

    // Agentic loop: keep going while the model wants to use tools
    let iteration = 0;
    const MAX_ITERATIONS = 25;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      let fullContent = "";
      let toolCalls: ToolCall[] | null = null;
      let tokenUsage: { input: number; output: number } | undefined;

      for await (const chunk of streamCopilotChat(
        messages,
        model,
        id,
        abortController.signal,
        _emit,
      )) {
        if (chunk.kind === "content") {
          fullContent += chunk.text;
          yield { type: "text_delta", id, content: chunk.text };
        } else if (chunk.kind === "tool_calls") {
          toolCalls = chunk.calls;
        } else if (chunk.kind === "done") {
          tokenUsage = chunk.usage;
        }
      }

      // Record assistant message in history
      const assistantMsg: ChatMessage = { role: "assistant" };
      if (fullContent) assistantMsg.content = fullContent;
      if (toolCalls) assistantMsg.tool_calls = toolCalls;
      messages.push(assistantMsg);

      // No tool calls → we're done
      if (!toolCalls || toolCalls.length === 0) {
        turnCommitted = true;
        yield {
          type: "turn_completed",
          id,
          status: "completed",
          sessionId: effectiveSessionId,
          tokenUsage,
          stopReason: "end_turn",
        };
        break;
      }

      // Execute tool calls
      for (const tc of toolCalls) {
        let args: Record<string, string>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "Failed to parse tool arguments as JSON",
          });
          continue;
        }

        const actionId = randomUUID();
        const toolName = tc.function.name;
        const needsApproval =
          toolName === "command" ||
          toolName === "file_write" ||
          toolName === "file_edit" ||
          toolName === "file_delete";

        // Emit action started
        yield {
          type: "action_started",
          id,
          actionId,
          actionType: toolName,
          summary: buildActionSummary(toolName, args),
          details: args as unknown as Record<string, unknown>,
        };

        // Request approval for write/command operations
        if (needsApproval && params.approvalPolicy !== "auto_approve") {
          const approvalId = randomUUID();
          yield {
            type: "approval_requested",
            id,
            approvalId,
            actionType: toolName,
            summary: buildActionSummary(toolName, args),
            details: args as unknown as Record<string, unknown>,
          };

          const decision = await waitForApproval(approvalId, abortController.signal);
          if (decision === "decline") {
            const rejectionMsg = `User rejected ${toolName} action`;
            yield {
              type: "action_completed",
              id,
              actionId,
              success: false,
              error: rejectionMsg,
            };
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: rejectionMsg,
            });
            continue;
          }
        }

        // Enforce sandbox constraints before execution
        const sandboxViolation = await checkSandbox(toolName, args, cwd, {
          sandboxMode: params.sandboxMode,
          writableRoots: params.writableRoots,
          allowNetwork: params.allowNetwork,
        });
        if (sandboxViolation) {
          yield {
            type: "action_completed",
            id,
            actionId,
            success: false,
            error: sandboxViolation,
          };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: sandboxViolation,
          });
          continue;
        }

        // Execute the tool
        const startMs = Date.now();
        const result = await executeTool(toolName, args, cwd);
        const durationMs = Date.now() - startMs;

        yield {
          type: "action_completed",
          id,
          actionId,
          success: result.success,
          output: result.output,
          error: result.error,
          durationMs,
        };

        // Feed result back to conversation
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.success
            ? result.output ?? ""
            : `Error: ${result.error}`,
        });
      }

      // Loop continues — model will see tool results and may respond or call more tools
    }

    if (iteration >= MAX_ITERATIONS) {
      turnCommitted = true;
      yield {
        type: "notice",
        id,
        kind: "copilot_max_iterations",
        level: "warning",
        title: "Iteration limit reached",
        message: `Copilot reached the maximum of ${MAX_ITERATIONS} tool-use iterations.`,
      };
      yield {
        type: "turn_completed",
        id,
        status: "completed",
        sessionId: effectiveSessionId,
        stopReason: "max_iterations",
      };
    }
  } catch (err: unknown) {
    const isAuthError =
      err instanceof Error && "isAuthError" in err && (err as { isAuthError: boolean }).isAuthError;
    yield {
      type: "error",
      id,
      message: err instanceof Error ? err.message : String(err),
      recoverable: !isAuthError,
      errorType: isAuthError ? "authentication_failed" : undefined,
      isAuthError: isAuthError || undefined,
    };
    yield {
      type: "turn_completed",
      id,
      status: "failed",
      sessionId: effectiveSessionId,
    };
  } finally {
    activeRequests.delete(id);

    // Rollback session history if the turn was not cleanly committed
    // This prevents cancelled/failed turns from poisoning later resumes
    if (!turnCommitted) {
      messages.length = historyCheckpoint;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildActionSummary(
  toolName: string,
  args: Record<string, string>,
): string {
  switch (toolName) {
    case "file_read":
      return `Read ${args.path}`;
    case "file_write":
      return `Write ${args.path}`;
    case "file_edit":
      return `Edit ${args.path}`;
    case "file_delete":
      return `Delete ${args.path}`;
    case "command":
      return `Run: ${args.command?.slice(0, 80)}`;
    case "search":
      return `Search: ${args.pattern}`;
    default:
      return `${toolName}`;
  }
}
