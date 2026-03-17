use tauri::State;

use crate::{
    db,
    models::{CreatedRemoteDeviceGrantDto, RemoteControllerLeaseDto, RemoteDeviceGrantDto},
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
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_remote_device_grants(
    state: State<'_, AppState>,
) -> Result<Vec<RemoteDeviceGrantDto>, String> {
    run_db(state.db.clone(), db::remote::list_device_grants).await
}

#[tauri::command]
pub async fn create_remote_device_grant(
    state: State<'_, AppState>,
    label: String,
    scopes: Vec<String>,
    expires_at: Option<String>,
) -> Result<CreatedRemoteDeviceGrantDto, String> {
    run_db(state.db.clone(), move |db| {
        db::remote::create_device_grant(db, &label, &scopes, expires_at.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn revoke_remote_device_grant(
    state: State<'_, AppState>,
    grant_id: String,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::remote::revoke_device_grant(db, &grant_id)
    })
    .await
}

#[tauri::command]
pub async fn get_active_remote_controller_lease(
    state: State<'_, AppState>,
    scope_type: String,
    scope_id: String,
) -> Result<Option<RemoteControllerLeaseDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::remote::get_active_controller_lease(db, &scope_type, &scope_id)
    })
    .await
}

#[tauri::command]
pub async fn acquire_remote_controller_lease(
    state: State<'_, AppState>,
    grant_id: String,
    scope_type: String,
    scope_id: String,
    ttl_secs: u64,
) -> Result<RemoteControllerLeaseDto, String> {
    run_db(state.db.clone(), move |db| {
        db::remote::acquire_controller_lease(db, &grant_id, &scope_type, &scope_id, ttl_secs)
    })
    .await
}

#[tauri::command]
pub async fn release_remote_controller_lease(
    state: State<'_, AppState>,
    lease_id: String,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::remote::release_controller_lease(db, &lease_id)
    })
    .await
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
