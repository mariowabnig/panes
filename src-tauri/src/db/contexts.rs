use std::path::Path;

use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{ContextDto, RepoDto};

use super::Database;

pub fn create_context(db: &Database, ctx: &ContextDto) -> anyhow::Result<ContextDto> {
    let id = if ctx.id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        ctx.id.clone()
    };

    let conn = db.connect()?;
    conn.execute(
        "INSERT INTO contexts (
            id, workspace_id, repo_id, worktree_path, branch_name, thread_id,
            display_name, pr_url, pr_number, status, terminal_recipe, editor_state,
            layout_mode, created_at, last_active_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id,
            ctx.workspace_id,
            ctx.repo_id,
            ctx.worktree_path,
            ctx.branch_name,
            ctx.thread_id,
            ctx.display_name,
            ctx.pr_url,
            ctx.pr_number,
            ctx.status,
            ctx.terminal_recipe,
            ctx.editor_state,
            ctx.layout_mode,
            ctx.created_at,
            ctx.last_active_at,
        ],
    )
    .context("failed to create context")?;

    get_context(db, &id)?.context("context not found after insert")
}

pub fn get_context(db: &Database, id: &str) -> anyhow::Result<Option<ContextDto>> {
    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, workspace_id, repo_id, worktree_path, branch_name, thread_id,
                display_name, pr_url, pr_number, status, terminal_recipe, editor_state,
                layout_mode, created_at, last_active_at
         FROM contexts WHERE id = ?1",
        params![id],
        map_context_row,
    )
    .optional()
    .context("failed to query context")
}

pub fn get_context_for_thread(
    db: &Database,
    thread_id: &str,
) -> anyhow::Result<Option<ContextDto>> {
    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, workspace_id, repo_id, worktree_path, branch_name, thread_id,
                display_name, pr_url, pr_number, status, terminal_recipe, editor_state,
                layout_mode, created_at, last_active_at
         FROM contexts
         WHERE thread_id = ?1 AND status != 'archived'",
        params![thread_id],
        map_context_row,
    )
    .optional()
    .context("failed to query context for thread")
}

pub fn list_contexts(db: &Database, workspace_id: &str) -> anyhow::Result<Vec<ContextDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, repo_id, worktree_path, branch_name, thread_id,
                display_name, pr_url, pr_number, status, terminal_recipe, editor_state,
                layout_mode, created_at, last_active_at
         FROM contexts
         WHERE workspace_id = ?1 AND status != 'archived'
         ORDER BY last_active_at DESC",
    )?;

    let rows = stmt.query_map(params![workspace_id], map_context_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn update_context(
    db: &Database,
    id: &str,
    update: &crate::models::ContextUpdateDto,
) -> anyhow::Result<()> {
    let conn = db.connect()?;

    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref status) = update.status {
        sets.push("status = ?");
        values.push(Box::new(status.clone()));
    }
    if let Some(ref thread_id) = update.thread_id {
        sets.push("thread_id = ?");
        values.push(Box::new(thread_id.clone()));
    }
    if let Some(ref terminal_recipe) = update.terminal_recipe {
        sets.push("terminal_recipe = ?");
        values.push(Box::new(terminal_recipe.clone()));
    }
    if let Some(ref editor_state) = update.editor_state {
        sets.push("editor_state = ?");
        values.push(Box::new(editor_state.clone()));
    }
    if let Some(ref layout_mode) = update.layout_mode {
        sets.push("layout_mode = ?");
        values.push(Box::new(layout_mode.clone()));
    }
    if let Some(ref last_active_at) = update.last_active_at {
        sets.push("last_active_at = ?");
        values.push(Box::new(last_active_at.clone()));
    }
    if let Some(ref archived_at) = update.archived_at {
        sets.push("archived_at = ?");
        values.push(Box::new(archived_at.clone()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    // Renumber placeholders: ?1, ?2, ... ?N, then id = ?N+1
    let numbered_sets: Vec<String> = sets
        .iter()
        .enumerate()
        .map(|(i, set_clause)| set_clause.replace('?', &format!("?{}", i + 1)))
        .collect();

    let id_param_index = values.len() + 1;
    let sql = format!(
        "UPDATE contexts SET {} WHERE id = ?{}",
        numbered_sets.join(", "),
        id_param_index
    );
    values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())
        .context("failed to update context")?;

    Ok(())
}

/// Archives contexts whose worktree paths no longer exist on disk.
/// Returns the number of contexts archived.
pub fn reconcile_contexts(db: &Database, workspace_id: &str) -> anyhow::Result<usize> {
    let contexts = list_contexts(db, workspace_id)?;
    let mut archived_count = 0;

    for ctx in &contexts {
        if let Some(ref wt_path) = ctx.worktree_path {
            if !Path::new(wt_path).exists() {
                log::warn!(
                    "Context '{}' worktree missing at {}, archiving",
                    ctx.display_name,
                    wt_path
                );
                archive_context(db, &ctx.id)?;
                archived_count += 1;
            }
        }
    }

    Ok(archived_count)
}

pub fn archive_context(db: &Database, id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE contexts SET status = 'archived', archived_at = datetime('now') WHERE id = ?1",
        params![id],
    )
    .context("failed to archive context")?;
    Ok(())
}

/// Resolves the effective working directory for a thread.
///
/// If the thread belongs to an active context with a worktree path that exists
/// on disk, returns that worktree path. Otherwise falls back to the repo path
/// (for repo-scoped threads) or the workspace root.
pub fn resolve_thread_effective_cwd(
    db: &Database,
    thread_id: &str,
    repo: Option<&RepoDto>,
    workspace_root: &str,
) -> anyhow::Result<String> {
    // Check if thread belongs to a context with a worktree
    if let Some(ctx) = get_context_for_thread(db, thread_id)? {
        if let Some(ref wt_path) = ctx.worktree_path {
            if Path::new(wt_path).exists() {
                return Ok(wt_path.clone());
            }
            log::warn!(
                "Context worktree path does not exist, falling back to repo path: {}",
                wt_path
            );
        }
    }

    // Default: repo path or workspace root
    Ok(repo
        .map(|r| r.path.clone())
        .unwrap_or_else(|| workspace_root.to_string()))
}

fn map_context_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ContextDto> {
    Ok(ContextDto {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        repo_id: row.get(2)?,
        worktree_path: row.get(3)?,
        branch_name: row.get(4)?,
        thread_id: row.get(5)?,
        display_name: row.get(6)?,
        pr_url: row.get(7)?,
        pr_number: row.get(8)?,
        status: row.get(9)?,
        terminal_recipe: row.get(10)?,
        editor_state: row.get(11)?,
        layout_mode: row.get(12)?,
        created_at: row.get(13)?,
        last_active_at: row.get(14)?,
    })
}
