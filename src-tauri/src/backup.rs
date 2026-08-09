//! Copias de seguridad de la base local.
//!
//! ## Por qué `VACUUM INTO` y no copiar el fichero
//!
//! Copiar `pos.db` con la aplicación abierta da una copia a medias: en modo WAL
//! los últimos cambios viven en `pos.db-wal`, no en el fichero principal, y una
//! copia hecha con el explorador de Windows se los deja fuera. Peor todavía: no
//! avisa. La copia parece correcta hasta el día que hace falta.
//!
//! `VACUUM INTO` es el mecanismo del propio SQLite para esto. Escribe una base
//! nueva, completa y consistente, sin detener a nadie y sin arrastrar ficheros
//! sueltos al lado. La copia se abre sola en cualquier visor.
//!
//! ## Qué NO hace
//!
//! Subir nada a ningún sitio. La carpeta de destino la elige quien instala, y
//! si esa carpeta resulta ser la de un servicio que sincroniza a la nube, pues
//! sube; pero eso es cosa suya, no de la aplicación. Meter credenciales de un
//! servicio de almacenamiento aquí sería otra cosa que custodiar.

use std::fs;
use std::path::{Path, PathBuf};

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row, SqliteConnection};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};

/// Prefijo de los ficheros que genera —y por tanto los únicos que borra al
/// hacer sitio. Una carpeta compartida con otras cosas no se toca.
const PREFIX: &str = "pos-";

fn is_backup(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with(PREFIX) && n.ends_with(".db"))
        .unwrap_or(false)
}

/// Deja solo las `keep` copias más recientes.
///
/// Se ordena por NOMBRE y no por fecha del sistema de ficheros: el nombre lleva
/// la marca de tiempo y no cambia si alguien mueve la carpeta o la restaura de
/// otro respaldo, mientras que la fecha del fichero sí.
fn prune(folder: &Path, keep: usize) -> Result<usize, String> {
    let mut files: Vec<PathBuf> = fs::read_dir(folder)
        .map_err(|e| format!("No se pudo leer {}: {e}", folder.display()))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && is_backup(p))
        .collect();

    if files.len() <= keep {
        return Ok(0);
    }

    files.sort();
    let excess = files.len() - keep;
    let mut removed = 0;
    for path in files.into_iter().take(excess) {
        // Un fichero que no se deja borrar —abierto en otro programa— no debe
        // tumbar la copia que se acaba de hacer. Se ignora y se reintentará.
        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[derive(serde::Serialize)]
pub struct BackupResult {
    pub path: String,
    pub bytes: u64,
    pub pruned: usize,
}

#[tauri::command]
pub async fn db_backup(
    db: String,
    path: String,
    keep: usize,
    instances: State<'_, DbInstances>,
) -> Result<BackupResult, String> {
    let target = PathBuf::from(&path);

    // Dos comprobaciones baratas antes de escribir nada. La ruta llega del
    // selector nativo de carpetas, no de la red, pero un destino equivocado aquí
    // significa sobrescribir algo de alguien.
    if target.extension().and_then(|e| e.to_str()) != Some("db") {
        return Err("La copia debe terminar en .db".into());
    }
    let folder = target
        .parent()
        .ok_or_else(|| "Ruta de destino sin carpeta".to_string())?;
    if !folder.is_dir() {
        return Err(format!("No existe la carpeta {}", folder.display()));
    }
    if target.exists() {
        return Err(format!("Ya existe {}", target.display()));
    }

    let map = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = map.get(&db) else {
        return Err(format!("la base «{db}» no está abierta"));
    };

    // La ruta va LIGADA, no interpolada: en Windows lleva barras invertidas y
    // puede llevar comillas, y meterla en el texto del SQL sería pedir que un
    // nombre de carpeta raro rompa la copia.
    sqlx::query("VACUUM INTO ?1")
        .bind(&path)
        .execute(pool)
        .await
        .map_err(|e| format!("No se pudo escribir la copia: {e}"))?;

    let bytes = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    // El borrado de las viejas va DESPUÉS de que la nueva exista. Al revés, un
    // fallo a mitad dejaría menos copias de las que había.
    let pruned = prune(folder, keep).unwrap_or(0);

    Ok(BackupResult {
        path,
        bytes,
        pruned,
    })
}

// =============================================================================
// Restaurar
// =============================================================================
//
// Una copia que no se sabe restaurar no es una copia. Antes esto eran tres
// instrucciones escritas —cerrar la aplicación, copiar el fichero encima, borrar
// los `-wal`—, y se ejecutan mal justo el día que hacen falta: con el local
// abierto, con prisa y con alguien mirando.
//
// **El cambio NO se hace en marcha.** Con la base abierta, sustituir el fichero
// por debajo deja a SQLite leyendo algo que ya no existe. Se deja preparado y se
// aplica al arrancar, antes de que nada la abra.
//
// El fichero que había NO se borra: se aparta a `pos.db.replaced`. Restaurar es
// la operación más destructiva de la aplicación —se pierde todo lo posterior a
// la copia— y tiene que poder deshacerse con un cambio de nombre.

/// Copia lista para entrar en el próximo arranque.
const STAGED: &str = "pos.db.restore";
/// La base que se apartó en la última restauración. Solo se guarda la última.
const REPLACED: &str = "pos.db.replaced";

/// Los primeros bytes de cualquier base de SQLite.
///
/// Es la comprobación más barata y descarta el error más probable con diferencia:
/// elegir un fichero que no es una copia.
fn looks_like_sqlite(head: &[u8]) -> bool {
    head.starts_with(b"SQLite format 3\0")
}

#[derive(serde::Serialize)]
pub struct RestoreCheck {
    /// Versión de esquema de la copia, para poder decirlo en pantalla.
    pub version: i64,
    pub bytes: u64,
}

/// Comprueba una copia y la deja preparada. No toca la base actual.
#[tauri::command]
pub async fn db_restore(app: AppHandle, source: String) -> Result<RestoreCheck, String> {
    let path = PathBuf::from(&source);
    let bytes = fs::metadata(&path)
        .map_err(|e| format!("No se pudo leer la copia: {e}"))?
        .len();

    let head = fs::read(&path)
        .map(|b| b.into_iter().take(16).collect::<Vec<u8>>())
        .map_err(|e| format!("No se pudo leer la copia: {e}"))?;
    if !looks_like_sqlite(&head) {
        return Err("Ese fichero no es una copia de la base.".into());
    }

    // Se abre en SOLO LECTURA y sin crear nada: si la ruta estuviera equivocada,
    // abrir en escritura fabricaría una base vacía y la daría por buena.
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .read_only(true)
        .create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("La copia no se puede abrir: {e}"))?;

    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| format!("La copia no se puede leer: {e}"))?;
    if integrity != "ok" {
        return Err(format!("La copia está dañada: {integrity}"));
    }

    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
           AND name IN ('settings','staff','orders','order_items')",
    )
    .fetch_one(&mut conn)
    .await
    .map_err(|e| format!("La copia no se puede leer: {e}"))?;
    if tables != 4 {
        return Err("Ese fichero es una base de SQLite, pero no de esta aplicación.".into());
    }

    // Una copia de una versión MÁS NUEVA no se puede abrir: las migraciones solo
    // van hacia adelante. Mejor decirlo aquí que dejar la aplicación sin arrancar.
    let version: i64 = sqlx::query("SELECT MAX(version) AS v FROM _sqlx_migrations")
        .fetch_one(&mut conn)
        .await
        .map(|row| row.try_get("v").unwrap_or(0))
        .unwrap_or(0);
    let _ = conn.close().await;

    let newest = crate::latest_migration();
    if version > newest {
        return Err(format!(
            "La copia es de una versión más nueva (esquema {version}, esta aplicación llega al {newest}). Actualiza antes de restaurarla."
        ));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se encontró la carpeta de datos: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo preparar la carpeta: {e}"))?;
    fs::copy(&path, dir.join(STAGED))
        .map_err(|e| format!("No se pudo preparar la restauración: {e}"))?;

    Ok(RestoreCheck { version, bytes })
}

/// Cierra y vuelve a abrir la aplicación, que es cuando se aplica lo preparado.
#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}

/// Aplica la copia preparada, si la hay. Se llama al arrancar.
///
/// Devuelve `true` si se restauró algo. Los pasos van en el orden que deja el
/// menor destrozo posible si la máquina se apaga a mitad: mientras `pos.db.restore`
/// siga ahí, el arranque siguiente lo vuelve a intentar.
pub fn apply_pending(dir: &Path) -> bool {
    let staged = dir.join(STAGED);
    if !staged.is_file() {
        return false;
    }
    let live = dir.join("pos.db");
    let replaced = dir.join(REPLACED);

    if live.exists() {
        let _ = fs::remove_file(&replaced);
        if fs::rename(&live, &replaced).is_err() {
            // La base está en uso: no se toca nada y se reintenta al arrancar
            // otra vez. Media restauración es peor que ninguna.
            return false;
        }
    }

    if let Err(e) = fs::rename(&staged, &live) {
        eprintln!("no se pudo colocar la copia restaurada: {e}");
        let _ = fs::rename(&replaced, &live);
        return false;
    }

    // Los `-wal` y `-shm` son del fichero ANTERIOR. Dejarlos al lado de una base
    // distinta es la forma más rápida de corromper las dos.
    let _ = fs::remove_file(dir.join("pos.db-wal"));
    let _ = fs::remove_file(dir.join("pos.db-shm"));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        fs::write(dir.join(name), b"x").unwrap();
    }

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "bk-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reconoce_solo_sus_propias_copias() {
        assert!(is_backup(Path::new("pos-20260802-190000.db")));
        assert!(!is_backup(Path::new("otra-cosa.db")));
        assert!(!is_backup(Path::new("pos-20260802.txt")));
        assert!(!is_backup(Path::new("pos.db")));
    }

    #[test]
    fn deja_las_mas_recientes_y_borra_las_viejas() {
        let dir = temp();
        for d in 1..=5 {
            touch(&dir, &format!("pos-2026080{d}-100000.db"));
        }
        let removed = prune(&dir, 2).unwrap();
        assert_eq!(removed, 3);

        let mut left: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, vec!["pos-20260804-100000.db", "pos-20260805-100000.db"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_toca_lo_que_no_es_suyo() {
        let dir = temp();
        for d in 1..=4 {
            touch(&dir, &format!("pos-2026080{d}-100000.db"));
        }
        touch(&dir, "fotos-boda.db");
        touch(&dir, "notas.txt");

        prune(&dir, 1).unwrap();

        assert!(dir.join("fotos-boda.db").exists(), "borro una base ajena");
        assert!(dir.join("notas.txt").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn con_menos_copias_que_el_limite_no_borra_nada() {
        let dir = temp();
        touch(&dir, "pos-20260801-100000.db");
        assert_eq!(prune(&dir, 5).unwrap(), 0);
        assert!(dir.join("pos-20260801-100000.db").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reconoce_una_base_de_sqlite_por_la_cabecera() {
        assert!(looks_like_sqlite(b"SQLite format 3\0mas cosas"));
        assert!(!looks_like_sqlite(b"\x89PNG\r\n\x1a\n"));
        assert!(!looks_like_sqlite(b""));
        // Sin el cero final es otra cosa que empieza parecido.
        assert!(!looks_like_sqlite(b"SQLite format 3x"));
    }

    #[test]
    fn sin_nada_preparado_no_hace_nada() {
        let dir = temp();
        fs::write(dir.join("pos.db"), b"la base de siempre").unwrap();
        assert!(!apply_pending(&dir));
        assert_eq!(fs::read(dir.join("pos.db")).unwrap(), b"la base de siempre");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn coloca_la_copia_y_aparta_la_anterior() {
        let dir = temp();
        fs::write(dir.join("pos.db"), b"lo de hoy").unwrap();
        fs::write(dir.join(STAGED), b"lo de la copia").unwrap();

        assert!(apply_pending(&dir));

        assert_eq!(fs::read(dir.join("pos.db")).unwrap(), b"lo de la copia");
        assert_eq!(fs::read(dir.join(REPLACED)).unwrap(), b"lo de hoy");
        assert!(!dir.join(STAGED).exists(), "la copia preparada se queda y se repetiria");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn borra_el_wal_de_la_base_anterior() {
        let dir = temp();
        fs::write(dir.join("pos.db"), b"lo de hoy").unwrap();
        fs::write(dir.join("pos.db-wal"), b"cambios sin volcar").unwrap();
        fs::write(dir.join("pos.db-shm"), b"indice").unwrap();
        fs::write(dir.join(STAGED), b"lo de la copia").unwrap();

        apply_pending(&dir);

        assert!(!dir.join("pos.db-wal").exists(), "un wal ajeno corrompe la base");
        assert!(!dir.join("pos.db-shm").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restaurar_dos_veces_no_pierde_la_base_de_partida() {
        // La segunda restauración aparta la primera copia, no la base original.
        // Se comprueba porque `pos.db.replaced` es la única marcha atrás que hay.
        let dir = temp();
        fs::write(dir.join("pos.db"), b"original").unwrap();

        fs::write(dir.join(STAGED), b"copia A").unwrap();
        apply_pending(&dir);
        fs::write(dir.join(STAGED), b"copia B").unwrap();
        apply_pending(&dir);

        assert_eq!(fs::read(dir.join("pos.db")).unwrap(), b"copia B");
        assert_eq!(fs::read(dir.join(REPLACED)).unwrap(), b"copia A");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn en_una_instalacion_nueva_la_copia_entra_igual() {
        // Sin `pos.db` todavía: restaurar en un equipo recién instalado es
        // justamente el caso de «se me murió el disco».
        let dir = temp();
        fs::write(dir.join(STAGED), b"lo de la copia").unwrap();

        assert!(apply_pending(&dir));

        assert_eq!(fs::read(dir.join("pos.db")).unwrap(), b"lo de la copia");
        assert!(!dir.join(REPLACED).exists());
        fs::remove_dir_all(&dir).ok();
    }
}
