//! Transacciones de verdad sobre la base local.
//!
//! ## Por qué hace falta esto
//!
//! `tauri-plugin-sql` mantiene un *pool* de conexiones (diez, por defecto) y
//! resuelve cada llamada con la que tenga libre en ese momento. Encadenar
//! `BEGIN`, las sentencias y `COMMIT` como tres llamadas separadas —que es lo
//! que hacía el ayudante de JavaScript— sale mal de tres maneras a la vez:
//!
//! 1. El `BEGIN` abre la transacción en una conexión y esta vuelve al pool con
//!    la transacción abierta.
//! 2. Las sentencias de dentro se ejecutan en otras conexiones, o sea **fuera**
//!    de la transacción. La atomicidad era decorativa.
//! 3. El `COMMIT` cae donde caiga. La conexión del paso 1 se queda con el
//!    candado de escritura tomado para siempre, y a partir de ahí cualquier
//!    escritura responde «database is locked».
//!
//! Aquí se toma **una** conexión, se hace todo dentro y se cierra. Si algo
//! falla, `Transaction` deshace al soltarse.

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

/// Mismo criterio de conversión que usa el plugin, para que una sentencia se
/// comporte igual dentro y fuera de una transacción.
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
            // Objetos y arrays viajan como texto JSON, igual que en el plugin.
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
    // `DbPool` solo tiene la variante SQLite: es la única característica
    // activada del plugin, a propósito, para no meter Postgres ni MySQL en el
    // instalador.
    let Some(DbPool::Sqlite(pool)) = map.get(&db) else {
        return Err(format!("la base «{db}» no está abierta"));
    };

    let mut tx: Transaction<'_, Sqlite> = pool.begin().await.map_err(|e| e.to_string())?;

    for statement in statements {
        bind(sqlx::query(&statement.sql), statement.values)
            .execute(&mut *tx)
            .await
            // Al salir por aquí `tx` se suelta sin confirmar y SQLite deshace
            // lo hecho hasta ahora. Ese es justo el comportamiento que se
            // buscaba desde el principio.
            .map_err(|e| format!("{}: {e}", statement.sql.trim()))?;
    }

    tx.commit().await.map_err(|e| e.to_string())
}

/// Aplica cambios llegados de otro terminal.
///
/// Levanta `sync_context.applying` antes y la baja después, **dentro de la
/// misma transacción y la misma conexión**. Con la bandera arriba los triggers
/// del buzón callan; si no, cada cambio recibido se volvería a apuntar como
/// propio y rebotaría entre equipos para siempre.
///
/// Eso solo es fiable desde aquí: hacerlo con dos llamadas desde JavaScript
/// dejaría la bandera levantada en una conexión cualquiera del pool, y afectaría
/// a escrituras que no tienen nada que ver.
#[tauri::command]
pub async fn sql_apply_remote(
    db: String,
    statements: Vec<Statement>,
    last_seq: i64,
    instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let map = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = map.get(&db) else {
        return Err(format!("la base «{db}» no está abierta"));
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

    // `last_seq` se guarda en la misma transacción que los cambios: si se
    // guardara aparte y fallara, el terminal volvería a pedir lo que ya aplicó,
    // o peor, se saltaría cambios que no llegó a aplicar.
    sqlx::query("UPDATE sync_context SET applying = 0, last_seq = ?1 WHERE id = 1")
        .bind(last_seq)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}
