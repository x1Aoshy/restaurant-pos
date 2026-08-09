mod backup;
mod printer;
mod tx;

use tauri_plugin_sql::{Migration, MigrationKind};

/// The local SQLite schema.
///
/// The plugin tracks which versions have been applied, so the database creates
/// and upgrades itself when the app opens. No account with any service and no
/// SQL to run by hand.
///
/// Two deliberate differences from a Postgres schema:
///
/// 1. **Money is stored as whole cents.** SQLite has no decimal type, and
///    keeping amounts in floating point produces one-cent gaps that nobody can
///    explain afterwards.
/// 2. **Enums become CHECK constraints.** SQLite has no enum type, but the
///    constraint gives the same guarantee.
///
/// The text of these files is hashed into the migration checksum. Editing one
/// that has already been applied stops the app from opening; a correction is
/// made by adding the next migration.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/001_initial.sql"),
        },
        Migration {
            version: 2,
            description: "stock ledger points at the order line",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/002_stock_ledger.sql"),
        },
        Migration {
            version: 3,
            description: "default language is english",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/003_default_language_en.sql"),
        },
        Migration {
            version: 4,
            description: "sync outbox (off by default)",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/004_sync_outbox.sql"),
        },
        Migration {
            version: 5,
            description: "sync server settings",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/005_sync_config.sql"),
        },
        Migration {
            version: 6,
            description: "merge tickets opened on two terminals at once",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/006_order_merge.sql"),
        },
        Migration {
            version: 7,
            description: "merged_into without a foreign key",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/007_merge_no_fk.sql"),
        },
        Migration {
            version: 8,
            description: "cash shifts, tips, discounts and printers",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/008_business_logic.sql"),
        },
        Migration {
            version: 9,
            description: "per-printer codepage and cut mode",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/009_printer_charset.sql"),
        },
        Migration {
            version: 10,
            description: "automatic backups",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/010_backups.sql"),
        },
        Migration {
            version: 11,
            description: "mark for lines sent to the kitchen",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/011_kitchen_sent.sql"),
        },
        Migration {
            version: 12,
            description: "cash tendered and change",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/012_cash_tendered.sql"),
        },
    ]
}

/// The highest schema version this build knows how to open.
///
/// Restoring uses it to reject a backup from a newer version: migrations only
/// move forward, and a database ahead of the binary leaves the app unable to
/// start.
pub(crate) fn latest_migration() -> i64 {
    migrations().iter().map(|m| m.version as i64).max().unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Before anything else: if a backup is waiting, it goes in now.
            // The SQL plugin does not open the database until the interface
            // asks for it, so this is the only moment the file can be replaced
            // with nobody holding it.
            let dir = tauri::Manager::path(app).app_data_dir()?;
            if backup::apply_pending(&dir) {
                println!("restored a backup into {}", dir.display());
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        // Saving a receipt as PDF needs the native dialog and file writing.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pos.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            tx::sql_transaction,
            tx::sql_apply_remote,
            printer::printer_print,
            printer::printer_open_drawer,
            printer::printer_test,
            backup::db_backup,
            backup::db_restore,
            backup::app_restart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
