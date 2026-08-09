//! Real transactions against the local database.
//!
//! ## Why this is needed
//!
//! `tauri-plugin-sql` keeps a connection *pool* (ten by default) and serves
//! each call with whichever connection is free at that moment. Chaining
//! `BEGIN`, the statements and `COMMIT` as three separate calls — which is what
//! the JavaScript helper used to do — goes wrong in three ways at once:
//!
//! 1. The `BEGIN` opens the transaction on one connection, which then returns
//!    to the pool with the transaction still open.
//! 2. The statements inside run on other connections, that is, **outside** the
//!    transaction. The atomicity was decorative.
//! 3. The `COMMIT` lands wherever it lands. The connection from step 1 keeps
//!    the write lock forever, and from then on every write answers
//!    "database is locked".
//!
//! Here **one** connection is taken, everything happens inside it, and it is
//! closed. If anything fails, `Transaction` rolls back when it is dropped.

use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::{Sqlite, Transaction};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    values: Vec<JsonValue>,
}

/// The same conversion rules the plugin uses, so a statement behaves the same
/// inside a transaction as it does outside one.
fn bind<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    values: Vec<JsonValue>,
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    for value in values {
        if value.is_null() {
            query = query.bind(None::<String>);
        } else if let Some(s) = value.as_str() {
            query = query.bind(s.to_owned());
        } else if let Some(b) = value.as_bool() {
            query = query.bind(b);
        } else if let Some(i) = value.as_i64() {
            query = query.bind(i);
        } else if let Some(f) = value.as_f64() {
            query = query.bind(f);
        } else {
            // Objects and arrays travel as JSON text, same as in the plugin.
            query = query.bind(value.to_string());
        }
    }
    query
}

#[tauri::command]
pub async fn sql_transaction(
    db: String,
    statements: Vec<Statement>,
    instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let map = instances.0.read().await;
    // `DbPool` only has the SQLite variant: it is the only plugin feature
    // enabled, deliberately, so that Postgres and MySQL drivers stay out of the
    // installer.
    let Some(DbPool::Sqlite(pool)) = map.get(&db) else {
        return Err(format!("database \"{db}\" is not open"));
    };

    let mut tx: Transaction<'_, Sqlite> = pool.begin().await.map_err(|e| e.to_string())?;

    for statement in statements {
        bind(sqlx::query(&statement.sql), statement.values)
            .execute(&mut *tx)
            .await
            // Leaving through here drops `tx` without committing and SQLite
            // undoes everything done so far. That is exactly the behaviour this
            // was written for.
            .map_err(|e| format!("{}: {e}", statement.sql.trim()))?;
    }

    tx.commit().await.map_err(|e| e.to_string())
}

/// Applies changes that arrived from another terminal.
///
/// Raises `sync_context.applying` before and lowers it after, **inside the same
/// transaction and the same connection**. With the flag up the outbox triggers
/// stay quiet; without it, every received change would be recorded again as if
/// it were local and would bounce between machines forever.
///
/// This is only reliable from here: doing it with two calls from JavaScript
/// would leave the flag raised on some arbitrary connection in the pool, and it
/// would affect writes that have nothing to do with syncing.
#[tauri::command]
pub async fn sql_apply_remote(
    db: String,
    statements: Vec<Statement>,
    last_seq: i64,
    instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let map = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = map.get(&db) else {
        return Err(format!("database \"{db}\" is not open"));
    };

    let mut tx: Transaction<'_, Sqlite> = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("UPDATE sync_context SET applying = 1 WHERE id = 1")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    for statement in statements {
        bind(sqlx::query(&statement.sql), statement.values)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}: {e}", statement.sql.trim()))?;
    }

    // `last_seq` is stored in the same transaction as the changes. Stored
    // separately and failing, the terminal would ask again for what it already
    // applied or, worse, skip changes it never applied.
    sqlx::query("UPDATE sync_context SET applying = 0, last_seq = ?1 WHERE id = 1")
        .bind(last_seq)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}
