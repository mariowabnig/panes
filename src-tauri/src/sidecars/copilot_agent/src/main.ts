import readline from "node:readline";
import { handleRequest, handleCancel, handleApprovalResponse } from "./runner.js";
import type { SidecarEvent, SidecarRequest } from "./protocol.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function emit(event: SidecarEvent) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

// Signal readiness to the Rust host
emit({ type: "ready" });

rl.on("line", async (line) => {
  let parsed: SidecarRequest;
  try {
    parsed = JSON.parse(line) as SidecarRequest;
  } catch {
    emit({
      type: "error",
      message: "invalid json from host",
      recoverable: true,
    });
    return;
  }

  if (parsed.method === "cancel") {
    handleCancel(parsed.params.requestId);
    return;
  }

  if (parsed.method === "approval_response") {
    handleApprovalResponse(parsed.params.approvalId, parsed.params.response.decision);
    return;
  }

  if (parsed.method === "query") {
    try {
      for await (const event of handleRequest(parsed, emit)) {
        emit(event);
      }
    } catch (err) {
      emit({
        type: "error",
        id: parsed.id,
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
      emit({
        type: "turn_completed",
        id: parsed.id,
        status: "failed",
      });
    }
    return;
  }

  emit({
    type: "error",
    message: `unknown method: ${(parsed as { method: string }).method}`,
    recoverable: true,
  });
});
