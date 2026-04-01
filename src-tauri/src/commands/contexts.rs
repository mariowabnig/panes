use tauri::State;

use crate::{
    db,
    models::{ContextDto, ContextUpdateDto},
    state::AppState,
};

async fn run_db<T, F>(db: crate::db::Database, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::Database) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(&db))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_context(
    state: State<'_, AppState>,
    ctx: ContextDto,
) -> Result<ContextDto, String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::create_context(db, &ctx)
    })
    .await
}

#[tauri::command]
pub async fn list_contexts(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ContextDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::list_contexts(db, &workspace_id)
    })
    .await
}

#[tauri::command]
pub async fn update_context(
    state: State<'_, AppState>,
    id: String,
    update: ContextUpdateDto,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::update_context(db, &id, &update)
    })
    .await
}

#[tauri::command]
pub async fn get_context_for_thread(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Option<ContextDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::get_context_for_thread(db, &thread_id)
    })
    .await
}

#[tauri::command]
pub async fn archive_context(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::archive_context(db, &id)
    })
    .await
}
