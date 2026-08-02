# Puesta en producción — x1Aoshy POS

## Docker no hace falta

Esto es una **aplicación de escritorio**, no un servicio. Docker sirve para
empaquetar procesos de servidor, y aquí no hay ninguno: la base de datos es un
fichero SQLite en el mismo equipo.

Lo que se distribuye es un **instalador de Windows**. Meterlo en un contenedor
no aportaría nada y complicaría la instalación.

```
Terminal (Windows)
  └── instalador .msi ──► x1Aoshy POS ──► pos.db
```

## Generar el instalador

```bash
npm run tauri build
```

Salida en `src-tauri/target/release/bundle/`:

- `msi/x1Aoshy POS_0.1.0_x64_en-US.msi` — instalador estándar de Windows
- `nsis/x1Aoshy POS_0.1.0_x64-setup.exe` — instalador NSIS

Cualquiera de los dos sirve. El `.msi` se despliega mejor por directiva de
grupo; el `.exe` es más habitual para instalación manual.

## Primer arranque

No hay nada que preparar. Al abrir la aplicación por primera vez:

1. Se crea `pos.db` y se aplican todas las migraciones en orden.
2. Aparece la pantalla de alta: nombre y PIN de la **cuenta de administración**.
   Esa primera cuenta es la única que se crea sola; el resto se dan de alta
   desde Usuarios.
3. Conviene entrar en Ajustes y poner el nombre del local, la moneda, el
   impuesto por defecto y el formato del ticket antes de empezar a vender.

## Dónde vive la base de datos

```
%APPDATA%\com.restaurant.pos\pos.db
```

Ese fichero **es** el negocio: ventas, cuentas, inventario y personal. Si el
disco muere, muere con él.

### Copias de seguridad

No hay copia automática. La forma más simple que funciona: una tarea programada
de Windows que copie el fichero a otro disco o a una carpeta sincronizada, con
la aplicación cerrada.

```bat
copy "%APPDATA%\com.restaurant.pos\pos.db" "D:\respaldo\pos-%DATE%.db"
```

Copiar el fichero con la aplicación abierta puede dar una copia a medias. Si
tiene que ser en caliente, usa `sqlite3 pos.db ".backup respaldo.db"`, que sí es
consistente.

## Actualizar a una versión nueva

Se instala encima. Las migraciones pendientes se aplican solas al arrancar y los
datos se conservan; el instalador no toca `%APPDATA%`.

**Haz copia del `.db` antes de actualizar.** Una migración no se deshace sola, y
volver a la versión anterior con una base ya migrada no está contemplado.

## Firma del ejecutable

Sin firma digital, Windows SmartScreen mostrará un aviso la primera vez. Para un
despliegue interno de pocos equipos es asumible: «Más información → Ejecutar de
todas formas».

Si vas a distribuirlo fuera, hace falta un certificado de firma de código (unos
200–400 USD al año) y añadir la configuración de firma en `tauri.conf.json`.

## Actualizaciones automáticas

La versión actual **no se auto-actualiza**: cada cambio requiere reinstalar.
Tauri incluye un actualizador que descarga y aplica versiones nuevas solo, pero
necesita un servidor donde publicar los manifiestos y firmar cada versión. Con
un único terminal no compensa.

## Impresora de tickets

El formato por defecto es **rollo térmico de 80 mm** (Ajustes → Ticket →
Formato). La aplicación genera el PDF; imprimirlo lo hace el visor del sistema
con la impresora térmica seleccionada.

Si en ese equipo no hay térmica, cambia el formato a **A4**.

## Varios terminales

No está soportado. Cada instalación tiene su propia base y no se hablan entre
ellas: dos equipos serían dos negocios distintos. Si algún día hacen falta dos
puestos, la pieza que falta es la sincronización, no la aplicación.
