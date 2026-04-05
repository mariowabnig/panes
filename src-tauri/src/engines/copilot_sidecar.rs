use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::Context;
use async_trait::async_trait;
use serde::Deserialize;
use tokio::time::timeout;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{process_utils, runtime_env};

use super::{
    normalize_approval_response_for_engine, ActionResult, ActionType, ApprovalRequestRoute, Engine,
    EngineEvent, EngineThread, ModelInfo, OutputStream, ReasoningEffortOption, SandboxPolicy,
    ThreadScope, TurnCompletionStatus, TurnInput,
};

// ── Sidecar event protocol ────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarEvent {
    Ready,
    SessionInit {
        id: Option<String>,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    TurnStarted {
        id: Option<String>,
    },
    TextDelta {
        id: Option<String>,
        content: String,
    },
    ThinkingDelta {
        id: Option<String>,
        content: String,
    },
    ActionStarted {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        #[serde(rename = "actionType")]
        action_type: String,
        summary: String,
        details: Option<serde_json::Value>,
    },
    ActionOutputDelta {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        stream: String,
        content: String,
    },
    ActionProgressUpdated {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        message: String,
    },
    ActionCompleted {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        success: bool,
        output: Option<String>,
        error: Option<String>,
        #[serde(rename = "durationMs")]
        duration_ms: Option<u64>,
    },
    ApprovalRequested {
        id: Option<String>,
        #[serde(rename = "approvalId")]
        approval_id: String,
        #[serde(rename = "actionType")]
        action_type: String,
        summary: String,
        details: Option<serde_json::Value>,
    },
    TurnCompleted {
        id: Option<String>,
        status: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        #[serde(rename = "tokenUsage")]
        token_usage: Option<SidecarTokenUsage>,
        #[serde(rename = "stopReason")]
        stop_reason: Option<String>,
    },
    Notice {
        id: Option<String>,
        kind: String,
        level: String,
        title: String,
        message: String,
    },
    UsageLimitsUpdated {
        id: Option<String>,
        usage: SidecarUsageLimits,
    },
    Error {
        id: Option<String>,
        message: String,
        recoverable: Option<bool>,
        #[serde(rename = "errorType")]
        error_type: Option<String>,
        #[serde(rename = "isAuthError")]
        is_auth_error: Option<bool>,
    },
    Version {
        id: Option<String>,
        #[serde(rename = "version")]
        _version: String,
    },
}

impl SidecarEvent {
    fn request_id(&self) -> Option<&str> {
        match self {
            SidecarEvent::Ready => None,
            SidecarEvent::SessionInit { id, .. }
            | SidecarEvent::TurnStarted { id, .. }
            | SidecarEvent::TextDelta { id, .. }
            | SidecarEvent::ThinkingDelta { id, .. }
            | SidecarEvent::ActionStarted { id, .. }
            | SidecarEvent::ActionOutputDelta { id, .. }
            | SidecarEvent::ActionProgressUpdated { id, .. }
            | SidecarEvent::ActionCompleted { id, .. }
            | SidecarEvent::ApprovalRequested { id, .. }
            | SidecarEvent::TurnCompleted { id, .. }
            | SidecarEvent::Notice { id, .. }
            | SidecarEvent::UsageLimitsUpdated { id, .. }
            | SidecarEvent::Error { id, .. }
            | SidecarEvent::Version { id, .. } => id.as_deref(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarTokenUsage {
    input: u64,
    output: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarUsageLimits {
    current_tokens: Option<u64>,
    max_context_tokens: Option<u64>,
    context_window_percent: Option<u8>,
    five_hour_percent: Option<u8>,
    weekly_percent: Option<u8>,
    five_hour_resets_at: Option<i64>,
    weekly_resets_at: Option<i64>,
}

// ── Transport ─────────────────────────────────────────────────────────

struct CopilotTransport {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    event_tx: broadcast::Sender<SidecarEvent>,
}

impl CopilotTransport {
    async fn spawn(sidecar_path: PathBuf) -> anyhow::Result<Self> {
        let node = resolve_node_executable()
            .await
            .context("Node.js is required for the Copilot sidecar but was not found")?;

        let sidecar_dir = sidecar_path
            .parent()
            .map(|path| path.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        let mut command = Command::new(&node);
        process_utils::configure_tokio_command(&mut command);
        if let Some(augmented_path) = executable_augmented_path(&node) {
            command.env("PATH", augmented_path);
        }
        // Pass through SSH/GPG auth env vars so the sidecar can git-push
        // over SSH even when Panes was launched from the Dock.
        for key in [
            "SSH_AUTH_SOCK",
            "SSH_AGENT_PID",
            "GIT_SSH_COMMAND",
            "GPG_TTY",
            // GitHub auth & config
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "GH_CONFIG_DIR",
            // Proxy / TLS config (needed when behind corporate proxies).
            // Lowercase variants are listed first; uppercase variants override
            // them if both are set (last `command.env()` call wins).
            "https_proxy",
            "http_proxy",
            "no_proxy",
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "NO_PROXY",
            "NODE_EXTRA_CA_CERTS",
            "SSL_CERT_FILE",
        ] {
            if let Ok(value) = std::env::var(key) {
                if !value.is_empty() {
                    command.env(key, value);
                }
            }
        }
        let mut child = command
            .arg("--import")
            .arg("tsx")
            .arg(&sidecar_path)
            .current_dir(&sidecar_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .with_context(|| {
                format!(
                    "failed to spawn copilot agent sidecar at {}",
                    sidecar_path.display()
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .context("copilot sidecar stdin not available")?;
        let stdout = child
            .stdout
            .take()
            .context("copilot sidecar stdout not available")?;
        let stderr = child
            .stderr
            .take()
            .context("copilot sidecar stderr not available")?;

        let (event_tx, _) = broadcast::channel(1024);

        // Stdout reader: parse JSON lines → broadcast SidecarEvents
        {
            let tx = event_tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => match serde_json::from_str::<SidecarEvent>(&line) {
                            Ok(event) => {
                                let _ = tx.send(event);
                            }
                            Err(e) => {
                                log::warn!(
                                    "copilot sidecar: failed to parse event: {e} — line: {line}"
                                );
                            }
                        },
                        Ok(None) => {
                            log::info!("copilot sidecar stdout EOF");
                            break;
                        }
                        Err(e) => {
                            log::warn!("copilot sidecar stdout read error: {e}");
                            break;
                        }
                    }
                }
            });
        }

        // Stderr reader: log only
        {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if !line.trim().is_empty() {
                                log::debug!("copilot sidecar stderr: {line}");
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
            });
        }

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            event_tx,
        })
    }

    fn resolve_sidecar_path(resource_dir: Option<&PathBuf>) -> anyhow::Result<PathBuf> {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("sidecars")
            .join("copilot_agent")
            .join("src")
            .join("main.ts");

        if dev_path.exists() {
            return Ok(dev_path);
        }

        if let Some(resource_dir) = resource_dir {
            let bundled_candidates = [
                resource_dir.join("copilot-agent-server.mjs"),
                resource_dir
                    .join("sidecar-dist")
                    .join("copilot-agent-server.mjs"),
            ];
            for candidate in bundled_candidates {
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }

        anyhow::bail!("copilot agent sidecar script not found in dev or bundled resources")
    }

    async fn send_command(&self, command: &serde_json::Value) -> anyhow::Result<()> {
        let mut stdin = self.stdin.lock().await;
        let payload = serde_json::to_string(command)? + "\n";
        stdin
            .write_all(payload.as_bytes())
            .await
            .context("failed to write to copilot sidecar stdin")?;
        stdin
            .flush()
            .await
            .context("failed to flush copilot sidecar stdin")?;
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<SidecarEvent> {
        self.event_tx.subscribe()
    }

    async fn is_alive(&self) -> bool {
        let mut child = self.child.lock().await;
        matches!(child.try_wait(), Ok(None))
    }

    async fn kill(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

// ── Per-thread config ─────────────────────────────────────────────────

#[derive(Clone)]
struct ThreadConfig {
    scope: ThreadScope,
    model_id: String,
    sandbox: SandboxPolicy,
    agent_session_id: Option<String>,
    active_request_id: Option<String>,
}

// ── Engine ─────────────────────────────────────────────────────────────

#[derive(Default)]
struct CopilotState {
    transport: Option<Arc<CopilotTransport>>,
    threads: HashMap<String, ThreadConfig>,
    resource_dir: Option<PathBuf>,
}

#[derive(Default)]
pub struct CopilotSidecarEngine {
    state: Arc<Mutex<CopilotState>>,
}

impl CopilotSidecarEngine {
    pub fn set_resource_dir(&self, resource_dir: Option<PathBuf>) {
        let mut state = self.state.blocking_lock();
        state.resource_dir = resource_dir;
    }

    pub async fn prewarm(&self) -> anyhow::Result<()> {
        self.ensure_transport().await.map(|_| ())
    }

    async fn ensure_transport(&self) -> anyhow::Result<Arc<CopilotTransport>> {
        let (existing_transport, resource_dir) = {
            let state = self.state.lock().await;
            (state.transport.clone(), state.resource_dir.clone())
        };

        if let Some(transport) = existing_transport {
            if transport.is_alive().await {
                return Ok(transport);
            }

            log::warn!("copilot sidecar process died, restarting…");
            let mut state = self.state.lock().await;
            if state
                .transport
                .as_ref()
                .map(|current| Arc::ptr_eq(current, &transport))
                .unwrap_or(false)
            {
                state.transport = None;
            }
        }

        let sidecar_path = CopilotTransport::resolve_sidecar_path(resource_dir.as_ref())?;
        let transport = Arc::new(CopilotTransport::spawn(sidecar_path).await?);

        // Wait for the "ready" event from the sidecar
        let mut rx = transport.subscribe();
        let ready = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                match rx.recv().await {
                    Ok(SidecarEvent::Ready) => return Ok::<(), anyhow::Error>(()),
                    Ok(SidecarEvent::Error { message, .. }) => {
                        anyhow::bail!("copilot sidecar startup error: {message}");
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        anyhow::bail!("copilot sidecar process terminated during startup");
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
        })
        .await;

        match ready {
            Ok(Ok(())) => log::info!("copilot agent sidecar is ready"),
            Ok(Err(e)) => {
                transport.kill().await;
                return Err(e);
            }
            Err(_) => {
                transport.kill().await;
                anyhow::bail!("copilot sidecar did not become ready within 15 seconds");
            }
        }

        let mut state = self.state.lock().await;
        if let Some(existing) = state.transport.clone() {
            if existing.is_alive().await {
                transport.kill().await;
                return Ok(existing);
            }
        }

        state.transport = Some(Arc::clone(&transport));
        Ok(transport)
    }

    fn parse_action_type(s: &str) -> ActionType {
        match s {
            "file_read" => ActionType::FileRead,
            "file_write" => ActionType::FileWrite,
            "file_edit" => ActionType::FileEdit,
            "file_delete" => ActionType::FileDelete,
            "command" => ActionType::Command,
            "git" => ActionType::Git,
            "search" => ActionType::Search,
            _ => ActionType::Other,
        }
    }

    fn parse_output_stream(s: &str) -> OutputStream {
        match s {
            "stderr" => OutputStream::Stderr,
            _ => OutputStream::Stdout,
        }
    }

    fn is_copilot_auth_error(
        message: &str,
        error_type: Option<&str>,
        is_auth_error: bool,
    ) -> bool {
        if is_auth_error {
            return true;
        }

        if error_type == Some("authentication_failed") {
            return true;
        }

        let normalized = message.to_lowercase();
        normalized.contains("authentication failed")
            || normalized.contains("sign in again")
            || normalized.contains("refresh your credentials")
    }

    pub async fn health_report(&self) -> CopilotHealthReport {
        let resource_dir = {
            let state = self.state.lock().await;
            state.resource_dir.clone()
        };
        let node_available = resolve_node_executable().await.is_some();
        let sidecar_exists =
            CopilotTransport::resolve_sidecar_path(resource_dir.as_ref()).is_ok();

        let mut checks = Vec::new();
        let mut warnings = Vec::new();
        let mut fixes = Vec::new();

        if node_available {
            checks.push("Node.js is available".to_string());
        } else {
            warnings.push("Node.js is not available for the Copilot engine".to_string());
            fixes.push("Install Node.js 20+ from https://nodejs.org".to_string());
        }

        if sidecar_exists {
            checks.push("Copilot agent sidecar script found".to_string());
        } else {
            warnings.push("Copilot agent sidecar script not found".to_string());
        }

        let available = node_available && sidecar_exists;

        CopilotHealthReport {
            available,
            version: if available {
                Some("copilot-agent".to_string())
            } else {
                None
            },
            details: if available {
                "Copilot Agent engine is ready".to_string()
            } else if !node_available {
                "Node.js is not available for the Copilot engine".to_string()
            } else if !sidecar_exists {
                "Copilot agent sidecar script not found in bundled resources".to_string()
            } else {
                "Copilot Agent engine has missing prerequisites".to_string()
            },
            warnings,
            checks,
            fixes,
        }
    }
}

async fn resolve_node_executable() -> Option<PathBuf> {
    if let Some(path) = runtime_env::resolve_executable("node") {
        return Some(path);
    }

    // Fall back to login-shell detection on Unix-like systems
    #[cfg(not(target_os = "windows"))]
    {
        for shell in runtime_env::login_probe_shells() {
            let output = match timeout(
                Duration::from_secs(2),
                Command::new(&shell)
                    .args(runtime_env::login_probe_shell_args(
                        &shell,
                        "command -v node",
                    ))
                    .output(),
            )
            .await
            {
                Ok(Ok(output)) if output.status.success() => output,
                _ => continue,
            };

            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(path) = stdout
                .lines()
                .map(str::trim)
                .find(|line| line.starts_with('/'))
                .map(PathBuf::from)
                .filter(|path| runtime_env::is_executable_file(path))
            {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for powershell in runtime_env::windows_login_probe_shells() {
            let mut cmd = Command::new(&powershell);
            cmd.args([
                "-NoLogo",
                "-Command",
                "(Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source",
            ]);
            process_utils::configure_tokio_command(&mut cmd);

            let Ok(Ok(output)) = timeout(Duration::from_secs(10), cmd.output()).await else {
                continue;
            };
            if !output.status.success() {
                continue;
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let Some(path) = runtime_env::parse_windows_single_path_output(&stdout) else {
                continue;
            };

            let path = PathBuf::from(path);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    None
}

fn executable_augmented_path(executable: &Path) -> Option<OsString> {
    runtime_env::augmented_path_with_prepend(
        executable
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    )
}

pub struct CopilotHealthReport {
    pub available: bool,
    pub version: Option<String>,
    pub details: String,
    pub warnings: Vec<String>,
    pub checks: Vec<String>,
    pub fixes: Vec<String>,
}

#[async_trait]
impl Engine for CopilotSidecarEngine {
    fn id(&self) -> &str {
        "copilot"
    }

    fn name(&self) -> &str {
        "Copilot"
    }

    fn models(&self) -> Vec<ModelInfo> {
        // Helper for the common three-level reasoning effort set.
        let three_level_efforts = || {
            vec![
                ReasoningEffortOption {
                    reasoning_effort: "low".to_string(),
                    description: "Quick, efficient responses".to_string(),
                },
                ReasoningEffortOption {
                    reasoning_effort: "medium".to_string(),
                    description: "Balanced reasoning".to_string(),
                },
                ReasoningEffortOption {
                    reasoning_effort: "high".to_string(),
                    description: "Deep, thorough reasoning".to_string(),
                },
            ]
        };

        vec![
            // ── Anthropic ─────────────────────────────────────────────
            ModelInfo {
                id: "claude-sonnet-4.5".to_string(),
                display_name: "Claude Sonnet 4.5".to_string(),
                description: "Copilot's default — fast and capable Anthropic model".to_string(),
                hidden: false,
                is_default: true,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: three_level_efforts(),
            },
            ModelInfo {
                id: "claude-sonnet-4.6".to_string(),
                display_name: "Claude Sonnet 4.6".to_string(),
                description: "Latest Anthropic Sonnet model".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: three_level_efforts(),
            },
            ModelInfo {
                id: "claude-opus-4.6".to_string(),
                display_name: "Claude Opus 4.6".to_string(),
                description: "Most intelligent Anthropic model for complex tasks".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: three_level_efforts(),
            },
            ModelInfo {
                id: "claude-haiku-4.5".to_string(),
                display_name: "Claude Haiku 4.5".to_string(),
                description: "Fast, lightweight Anthropic model".to_string(),
                hidden: false,
                is_default: false,
                upgrade: Some("claude-sonnet-4.5".to_string()),
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "low".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick, efficient responses".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balanced reasoning".to_string(),
                    },
                ],
            },
            // ── OpenAI ────────────────────────────────────────────────
            ModelInfo {
                id: "gpt-5.4".to_string(),
                display_name: "GPT-5.4".to_string(),
                description: "Latest OpenAI frontier model".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: three_level_efforts(),
            },
            ModelInfo {
                id: "gpt-5-mini".to_string(),
                display_name: "GPT-5 Mini".to_string(),
                description: "Fast OpenAI model — no premium requests consumed".to_string(),
                hidden: false,
                is_default: false,
                upgrade: Some("gpt-5.4".to_string()),
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "low".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick, efficient responses".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balanced reasoning".to_string(),
                    },
                ],
            },
            ModelInfo {
                id: "gpt-4.1".to_string(),
                display_name: "GPT-4.1".to_string(),
                description: "Reliable OpenAI model — no premium requests consumed".to_string(),
                hidden: false,
                is_default: false,
                upgrade: Some("gpt-5.4".to_string()),
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: three_level_efforts(),
            },
            // ── Google ────────────────────────────────────────────────
            ModelInfo {
                id: "gemini-2.5-pro".to_string(),
                display_name: "Gemini 2.5 Pro".to_string(),
                description: "Google's advanced reasoning model".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: three_level_efforts(),
            },
            // ── xAI ──────────────────────────────────────────────────
            ModelInfo {
                id: "grok-code-fast-1".to_string(),
                display_name: "Grok Code Fast 1".to_string(),
                description: "Fast xAI coding model".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: three_level_efforts(),
            },
        ]
    }

    async fn is_available(&self) -> bool {
        resolve_node_executable().await.is_some() && {
            let state = self.state.lock().await;
            CopilotTransport::resolve_sidecar_path(state.resource_dir.as_ref()).is_ok()
        }
    }

    async fn start_thread(
        &self,
        scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> Result<EngineThread, anyhow::Error> {
        let (engine_thread_id, existing_session) = {
            let state = self.state.lock().await;
            let session_id = resume_engine_thread_id.and_then(|id| {
                state
                    .threads
                    .get(id)
                    .and_then(|config| config.agent_session_id.clone())
                    .or_else(|| {
                        if Uuid::parse_str(id).is_ok() {
                            Some(id.to_string())
                        } else {
                            None
                        }
                    })
            });
            let engine_thread_id = session_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            (engine_thread_id, session_id)
        };

        let config = ThreadConfig {
            scope,
            model_id: model.to_string(),
            sandbox,
            agent_session_id: existing_session,
            active_request_id: None,
        };

        let mut state = self.state.lock().await;
        state.threads.insert(engine_thread_id.clone(), config);

        Ok(EngineThread { engine_thread_id })
    }

    async fn send_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_transport().await?;

        let thread_config = {
            let state = self.state.lock().await;
            state
                .threads
                .get(engine_thread_id)
                .cloned()
                .context("no thread config found — was start_thread called?")?
        };

        let request_id = Uuid::new_v4().to_string();
        {
            let mut state = self.state.lock().await;
            if let Some(config) = state.threads.get_mut(engine_thread_id) {
                config.active_request_id = Some(request_id.clone());
            }
        }

        let cwd = match &thread_config.scope {
            ThreadScope::Repo { repo_path } => repo_path.clone(),
            ThreadScope::Workspace { root_path, .. } => root_path.clone(),
        };

        let TurnInput {
            message,
            attachments,
            plan_mode,
            input_items: _,
        } = input;

        let mut params = serde_json::json!({
            "prompt": message,
            "attachments": attachments
                .iter()
                .map(|attachment| {
                    serde_json::json!({
                        "fileName": attachment.file_name,
                        "filePath": attachment.file_path,
                        "sizeBytes": attachment.size_bytes,
                        "mimeType": attachment.mime_type,
                    })
                })
                .collect::<Vec<_>>(),
            "cwd": cwd,
            "model": thread_config.model_id,
            "approvalPolicy": thread_config
                .sandbox
                .approval_policy
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            "allowNetwork": thread_config.sandbox.allow_network,
            "writableRoots": thread_config.sandbox.writable_roots.clone(),
            "sandboxMode": thread_config.sandbox.sandbox_mode.clone(),
            "reasoningEffort": thread_config.sandbox.reasoning_effort.clone(),
            "planMode": plan_mode,
        });

        if let Some(ref session_id) = thread_config.agent_session_id {
            params["resume"] = serde_json::Value::String(session_id.clone());
        } else {
            params["sessionId"] = serde_json::Value::String(engine_thread_id.to_string());
        }

        let command = serde_json::json!({
            "id": request_id,
            "method": "query",
            "params": params,
        });

        let mut rx = transport.subscribe();
        transport.send_command(&command).await?;

        let engine_thread_id_owned = engine_thread_id.to_string();
        let state_ref = Arc::clone(&self.state);
        let mut auth_invalidated_transport = false;

        loop {
            tokio::select! {
                _ = cancellation.cancelled() => {
                    let cancel_cmd = serde_json::json!({
                        "method": "cancel",
                        "params": { "requestId": request_id.clone() },
                    });
                    let _ = transport.send_command(&cancel_cmd).await;
                    let mut state = self.state.lock().await;
                    if let Some(config) = state.threads.get_mut(engine_thread_id) {
                        config.active_request_id = None;
                    }
                    return Ok(());
                }
                event = rx.recv() => {
                    match event {
                        Ok(sidecar_event) => {
                            if let Some(eid) = sidecar_event.request_id() {
                                if eid != request_id {
                                    continue;
                                }
                            }

                            match sidecar_event {
                                SidecarEvent::TurnStarted { .. } => {
                                    event_tx
                                        .send(EngineEvent::TurnStarted {
                                            client_turn_id: None,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::SessionInit { session_id, .. } => {
                                    let mut state = state_ref.lock().await;
                                    if let Some(config) = state.threads.get_mut(&engine_thread_id_owned) {
                                        config.agent_session_id = Some(session_id);
                                    }
                                }
                                SidecarEvent::TextDelta { content, .. } => {
                                    event_tx
                                        .send(EngineEvent::TextDelta { content })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ThinkingDelta { content, .. } => {
                                    event_tx
                                        .send(EngineEvent::ThinkingDelta { content })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionStarted {
                                    action_id,
                                    action_type,
                                    summary,
                                    details,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionStarted {
                                            action_id: action_id.clone(),
                                            engine_action_id: None,
                                            action_type: Self::parse_action_type(&action_type),
                                            summary,
                                            details: details.unwrap_or(serde_json::json!({})),
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionOutputDelta {
                                    action_id,
                                    stream,
                                    content,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionOutputDelta {
                                            action_id,
                                            stream: Self::parse_output_stream(&stream),
                                            content,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionProgressUpdated {
                                    action_id,
                                    message,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionProgressUpdated {
                                            action_id,
                                            message,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionCompleted {
                                    action_id,
                                    success,
                                    output,
                                    error,
                                    duration_ms,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionCompleted {
                                            action_id,
                                            result: ActionResult {
                                                success,
                                                output,
                                                error,
                                                diff: None,
                                                duration_ms: duration_ms.unwrap_or(0),
                                            },
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ApprovalRequested {
                                    approval_id,
                                    action_type,
                                    summary,
                                    details,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ApprovalRequested {
                                            approval_id,
                                            action_type: Self::parse_action_type(&action_type),
                                            summary,
                                            details: details.unwrap_or(serde_json::json!({})),
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::TurnCompleted {
                                    status,
                                    session_id,
                                    token_usage,
                                    stop_reason,
                                    ..
                                } => {
                                    if let Some(sid) = session_id {
                                        let mut state = state_ref.lock().await;
                                        if let Some(config) = state.threads.get_mut(&engine_thread_id_owned) {
                                            config.agent_session_id = Some(sid);
                                        }
                                    }

                                    let completion_status = match status.as_str() {
                                        "completed" => TurnCompletionStatus::Completed,
                                        "interrupted" => TurnCompletionStatus::Interrupted,
                                        _ => TurnCompletionStatus::Failed,
                                    };
                                    if let Some(ref stop_reason) = stop_reason {
                                        if stop_reason != "end_turn" {
                                            event_tx
                                                .send(EngineEvent::Notice {
                                                    kind: "copilot_stop_reason".to_string(),
                                                    level: "info".to_string(),
                                                    title: "Copilot stop reason".to_string(),
                                                    message: stop_reason.clone(),
                                                })
                                                .await
                                                .ok();
                                        }
                                    }
                                    event_tx
                                        .send(EngineEvent::TurnCompleted {
                                            token_usage: token_usage.map(|usage| super::TokenUsage {
                                                input: usage.input,
                                                output: usage.output,
                                            }),
                                            status: completion_status,
                                        })
                                        .await
                                        .ok();
                                    let mut state = self.state.lock().await;
                                    if let Some(config) = state.threads.get_mut(engine_thread_id) {
                                        config.active_request_id = None;
                                    }
                                    break;
                                }
                                SidecarEvent::Notice {
                                    kind,
                                    level,
                                    title,
                                    message,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::Notice {
                                            kind,
                                            level,
                                            title,
                                            message,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::UsageLimitsUpdated { usage, .. } => {
                                    event_tx
                                        .send(EngineEvent::UsageLimitsUpdated {
                                            usage: super::UsageLimitsSnapshot {
                                                current_tokens: usage.current_tokens,
                                                max_context_tokens: usage.max_context_tokens,
                                                context_window_percent: usage.context_window_percent,
                                                five_hour_percent: usage.five_hour_percent,
                                                weekly_percent: usage.weekly_percent,
                                                five_hour_resets_at: usage.five_hour_resets_at,
                                                weekly_resets_at: usage.weekly_resets_at,
                                            },
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::Error {
                                    message,
                                    recoverable,
                                    error_type,
                                    is_auth_error,
                                    ..
                                } => {
                                    if Self::is_copilot_auth_error(
                                        &message,
                                        error_type.as_deref(),
                                        is_auth_error.unwrap_or(false),
                                    ) {
                                        auth_invalidated_transport = true;
                                        let mut state = self.state.lock().await;
                                        if state
                                            .transport
                                            .as_ref()
                                            .map(|current| Arc::ptr_eq(current, &transport))
                                            .unwrap_or(false)
                                        {
                                            state.transport = None;
                                        }
                                        drop(state);
                                        transport.kill().await;
                                    }
                                    event_tx
                                        .send(EngineEvent::Error {
                                            message,
                                            recoverable: recoverable.unwrap_or(false),
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::Ready | SidecarEvent::Version { .. } => {}
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            log::warn!("copilot sidecar: event receiver lagged by {n} messages");
                            event_tx
                                .send(EngineEvent::Notice {
                                    kind: "copilot_event_lag".to_string(),
                                    level: "warning".to_string(),
                                    title: "Copilot event lag".to_string(),
                                    message: format!(
                                        "Copilot sidecar event stream skipped {n} messages under load."
                                    ),
                                })
                                .await
                                .ok();
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            if !auth_invalidated_transport {
                                event_tx
                                    .send(EngineEvent::Error {
                                        message: "Copilot sidecar process terminated unexpectedly"
                                            .to_string(),
                                        recoverable: false,
                                    })
                                    .await
                                    .ok();
                            }
                            event_tx
                                .send(EngineEvent::TurnCompleted {
                                    token_usage: None,
                                    status: TurnCompletionStatus::Failed,
                                })
                                .await
                                .ok();
                            let mut state = state_ref.lock().await;
                            if let Some(config) = state.threads.get_mut(&engine_thread_id_owned) {
                                config.active_request_id = None;
                            }
                            state.transport = None;
                            break;
                        }
                    }
                }
            }
        }

        let mut state = self.state.lock().await;
        if let Some(config) = state.threads.get_mut(engine_thread_id) {
            config.active_request_id = None;
        }

        Ok(())
    }

    async fn steer_message(
        &self,
        _engine_thread_id: &str,
        _input: TurnInput,
    ) -> Result<(), anyhow::Error> {
        anyhow::bail!("Copilot does not support mid-turn steering")
    }

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: serde_json::Value,
        _route: Option<ApprovalRequestRoute>,
    ) -> Result<(), anyhow::Error> {
        let normalized_response = normalize_approval_response_for_engine("copilot", response)
            .map_err(anyhow::Error::msg)?;
        let state = self.state.lock().await;
        if let Some(ref transport) = state.transport {
            let approval_cmd = serde_json::json!({
                "method": "approval_response",
                "params": {
                    "approvalId": approval_id,
                    "response": normalized_response,
                },
            });
            transport.send_command(&approval_cmd).await?;
        }
        Ok(())
    }

    async fn interrupt(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let state = self.state.lock().await;
        let Some(ref transport) = state.transport else {
            return Ok(());
        };
        let request_id = state
            .threads
            .get(engine_thread_id)
            .and_then(|config| config.active_request_id.clone());
        if let Some(request_id) = request_id {
            let cancel_cmd = serde_json::json!({
                "method": "cancel",
                "params": { "requestId": request_id },
            });
            transport.send_command(&cancel_cmd).await?;
        }
        Ok(())
    }

    async fn archive_thread(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let mut state = self.state.lock().await;
        state.threads.remove(engine_thread_id);
        Ok(())
    }

    async fn unarchive_thread(&self, _engine_thread_id: &str) -> Result<(), anyhow::Error> {
        Ok(())
    }
}
