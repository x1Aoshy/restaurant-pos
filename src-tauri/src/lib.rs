mod tx;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Esquema local en SQLite.
///
/// El plugin lleva la cuenta de qué versiones se aplicaron, así que la base se
/// crea y se actualiza sola al abrir la aplicación. Sin cuenta en ningún
/// servicio y sin ejecutar SQL a mano.
///
/// Dos diferencias deliberadas respecto al esquema de Postgres:
///
/// 1. **El dinero se guarda en centavos, como enteros.** SQLite no tiene tipo
///    decimal y almacenar importes en coma flotante produce descuadres de un
///    centavo que luego nadie sabe explicar.
/// 2. **Los enumerados pasan a CHECK.** SQLite no tiene tipos enumerados, pero
///    la restricción da la misma garantía.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "esquema inicial",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/001_initial.sql"),
        },
        Migration {
            version: 2,
            description: "el libro de inventario apunta a la linea de comanda",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/002_stock_ledger.sql"),
        },
        Migration {
            version: 3,
            description: "idioma de partida en ingles",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/003_default_language_en.sql"),
        },
        Migration {
            version: 4,
            description: "buzon de cambios para sincronizar (apagado)",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/004_sync_outbox.sql"),
        },
        Migration {
            version: 5,
            description: "configuracion del servidor de sincronizacion",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/005_sync_config.sql"),
        },
        Migration {
            version: 6,
            description: "fusion de comandas abiertas a la vez en dos terminales",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/006_order_merge.sql"),
        },
        Migration {
            version: 7,
            description: "merged_into sin clave foranea",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/007_merge_no_fk.sql"),
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Guardar el ticket en PDF necesita diálogo nativo y escritura.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pos.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            tx::sql_transaction,
            tx::sql_apply_remote
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
