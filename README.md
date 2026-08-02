# x1Aoshy POS

Punto de venta de escritorio para restaurante. Registro de comandas, control de
mesas, inventario con recetas, gastos, historial de facturación y emisión de
tickets en PDF.

## Cómo funciona

Aplicación de escritorio para Windows con **la base de datos en el propio
equipo**. No hay servidor que mantener, ni cuenta en ningún servicio, ni
conexión a internet: se instala y funciona.

```
Terminal (Windows)
  └── x1Aoshy POS ──► pos.db  (SQLite, en el equipo)
```

Está pensado para el caso real de un salón: **un ordenador** donde alguien pasa
las comandas de papel. No una tableta por mesero. Por eso todo cabe en una
pantalla y se maneja con el teclado.

## Pila

| Capa | Tecnología |
|---|---|
| Escritorio | Tauri 2 (Rust) |
| Interfaz | React 19 · TypeScript · Vite |
| Estilos | Tailwind 4 · Base UI |
| Datos | SQLite local (`tauri-plugin-sql`) |
| Tickets | jsPDF — 80 mm térmico o A4 |

## Principios del diseño

**El dinero nunca es un decimal.** Los importes se guardan y se operan en
centavos enteros, y las tasas en puntos básicos (1000 = 10 %). SQLite no tiene
tipo decimal, y en coma flotante `0,1 + 0,2` no es `0,3`: sobre cien líneas eso
son descuadres de un centavo que aparecen justo al cuadrar la caja y que nadie
sabe explicar.

**Los totales los calcula la base.** La interfaz manda producto y cantidad; el
subtotal, el impuesto y el total los resuelven triggers de SQLite. El impuesto
se redondea **por línea** antes de sumar, igual que en el ticket impreso — si se
redondeara solo al final, el papel y la base dirían cifras distintas.

**Los precios se congelan al vender.** `order_items` guarda copia del precio y
de la tasa del momento. Cambiar la carta no reescribe tickets ya emitidos.

**El inventario es un libro mayor.** El stock es la suma de los movimientos, no
un campo editable. Cada apunte queda atado a la línea de comanda que lo produjo,
así que corregir una cantidad, anular una cuenta o borrarla mueven exactamente
lo que corresponde. Un error se arregla con un asiento de ajuste, nunca borrando
historial.

**Las fechas son las del local, no las de UTC.** Los informes agrupan por fecha
local. Sin eso, en Nicaragua (UTC−6) todo lo cobrado a partir de las 18:00 —las
horas de más venta— contaría como del día siguiente.

## Desarrollo

```bash
npm install
```

```bash
npm run tauri dev
```

La base se crea sola al abrir la aplicación por primera vez y las migraciones se
aplican en orden sin intervención. La primera pantalla pide crear la cuenta de
administración.

Una única instancia a la vez: el puerto 1420 es fijo y el binario queda
bloqueado mientras la aplicación corre.

### Comprobaciones

```bash
npm run verify
```

Encadena tres cosas: tipos (`tsc`), paridad entre los diccionarios de español e
inglés, y los triggers del esquema contra un SQLite de verdad. Lo último no es
ceremonia: un trigger que descuenta de menos no da error, solo hace que el
recuento del día mienta.

## Producción

```bash
npm run tauri build
```

Genera instaladores `.msi` y `.exe` en `src-tauri/target/release/bundle/`.

Pasos completos en `DEPLOY.md`. Modelo de amenaza y estado de la revisión en
`SECURITY.md`.

## Estructura

```
src/
  components/      barra lateral, layout, barra de título, pantallas de acceso
  features/        pos · orders · floor · products · inventory · tickets · dashboard
  providers/       sesión · i18n · tema · salón · menú
  routes/          pantallas, incluidas las de administración
  lib/             base de datos, dinero, PIN, formato, idiomas
  types/local.ts   filas de SQLite, con sufijo de unidad en cada importe
src-tauri/
  migrations/      esquema y triggers — se aplican solos al arrancar
  capabilities/    permisos de ventana, SQL, ficheros y diálogos
scripts/           comprobaciones de esquema y traducciones
```
