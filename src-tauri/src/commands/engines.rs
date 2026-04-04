use std::path::PathBuf;
use std::time::Instant;

use anyhow::Context;
use tauri::State;
use tokio::process::Command;

#[cfg(not(target_os = "windows"))]
use crate::runtime_env;
use crate::{
    models::{
        ClaudeSkillDto, CodexAppDto, CodexSkillDto, EngineCheckResultDto, EngineHealthDto,
        EngineInfoDto,
    },
    process_utils,
    state::AppState,
};

#[tauri::command]
pub async fn list_engines(state: State<'_, AppState>) -> Result<Vec<EngineInfoDto>, String> {
    state.engines.list_engines().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn engine_health(
    state: State<'_, AppState>,
    engine_id: String,
) -> Result<EngineHealthDto, String> {
    state
        .engines
        .health(&engine_id)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn prewarm_engine(state: State<'_, AppState>, engine_id: String) -> Result<(), String> {
    state
        .engines
        .prewarm(&engine_id)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_codex_skills(
    state: State<'_, AppState>,
    cwd: String,
) -> Result<Vec<CodexSkillDto>, String> {
    state
        .engines
        .list_codex_skills(cwd.trim())
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_claude_skills() -> Result<Vec<ClaudeSkillDto>, String> {
    let skills_dir = crate::runtime_env::home_dir()
        .map(|h| h.join(".claude").join("skills"))
        .unwrap_or_else(|| PathBuf::from(""));

    if !skills_dir.is_dir() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();
    let entries = std::fs::read_dir(&skills_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let skill_md = entry.path().join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let content = match std::fs::read_to_string(&skill_md) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let (name, description) = parse_skill_frontmatter(&content);
        let name = name.unwrap_or_else(|| {
            entry
                .file_name()
                .to_string_lossy()
                .to_string()
        });
        skills.push(ClaudeSkillDto {
            name,
            description: description.unwrap_or_default(),
        });
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    let after_open = &trimmed[3..];
    let end = match after_open.find("\n---") {
        Some(pos) => pos,
        None => return (None, None),
    };
    let frontmatter = &after_open[..end];

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut in_multiline_desc = false;
    let mut desc_lines: Vec<String> = Vec::new();

    for line in frontmatter.lines() {
        if in_multiline_desc {
            let stripped = line.trim();
            if stripped.is_empty() || (!line.starts_with(' ') && !line.starts_with('\t')) {
                in_multiline_desc = false;
                description = Some(desc_lines.join(" ").trim().to_string());
                // Still process this line for other keys
                if let Some((key, value)) = line.split_once(':') {
                    let key = key.trim();
                    let value = value.trim().trim_matches('"');
                    if key == "name" && !value.is_empty() {
                        name = Some(value.to_string());
                    }
                }
            } else {
                desc_lines.push(stripped.to_string());
                continue;
            }
            continue;
        }

        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();
            match key {
                "name" => {
                    let v = value.trim_matches('"');
                    if !v.is_empty() {
                        name = Some(v.to_string());
                    }
                }
                "description" => {
                    if value == ">" || value == "|" {
                        in_multiline_desc = true;
                        desc_lines.clear();
                    } else {
                        let v = value.trim_matches('"');
                        if !v.is_empty() {
                            description = Some(v.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if in_multiline_desc && !desc_lines.is_empty() {
        description = Some(desc_lines.join(" ").trim().to_string());
    }

    (name, description)
}

#[tauri::command]
pub async fn list_codex_apps(state: State<'_, AppState>) -> Result<Vec<CodexAppDto>, String> {
    state.engines.list_codex_apps().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn run_engine_check(
    state: State<'_, AppState>,
    engine_id: String,
    command: String,
) -> Result<EngineCheckResultDto, String> {
    let health = state
        .engines
        .health(&engine_id)
        .await
        .map_err(err_to_string)?;
    let is_allowed = health
        .checks
        .iter()
        .chain(health.fixes.iter())
        .any(|value| value == &command);

    if !is_allowed {
        return Err("command is not allowed for this engine check".to_string());
    }

    execute_engine_check_command(&command)
        .await
        .map_err(err_to_string)
}

async fn execute_engine_check_command(command: &str) -> anyhow::Result<EngineCheckResultDto> {
    let started = Instant::now();

    let output = build_shell_command(command)
        .output()
        .await
        .with_context(|| format!("failed to execute check command: `{command}`"))?;

    let duration_ms = started.elapsed().as_millis();

    Ok(EngineCheckResultDto {
        command: command.to_string(),
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: truncate_output(&String::from_utf8_lossy(&output.stdout), 12_000),
        stderr: truncate_output(&String::from_utf8_lossy(&output.stderr), 12_000),
        duration_ms,
    })
}

#[cfg(target_os = "windows")]
fn build_shell_command(command: &str) -> Command {
    let mut cmd = Command::new("cmd");
    process_utils::configure_tokio_command(&mut cmd);
    cmd.arg("/C").arg(command);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn build_shell_command(command: &str) -> Command {
    let spec = runtime_env::command_shell_for_string(command);
    let mut cmd = Command::new(&spec.program);
    process_utils::configure_tokio_command(&mut cmd);
    cmd.args(&spec.args);
    if let Some(augmented_path) = runtime_env::augmented_path_with_prepend(
        spec.program
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    ) {
        cmd.env("PATH", augmented_path);
    }
    cmd
}

fn truncate_output(value: &str, max_chars: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= max_chars {
        return value.to_string();
    }

    let mut out = chars.into_iter().take(max_chars).collect::<String>();
    out.push_str("\n...[truncated]");
    out
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
