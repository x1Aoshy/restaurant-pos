# Sincronización entre terminales — diseño

Estado: **fase 1 construida, apagada por defecto.** El resto está diseñado pero
sin escribir. Este documento existe para que se vea qué falta y por qué cada
pieza está donde está.

## Lo que hay que resolver

Sincronizar no es «subir la base». Con dos terminales apareen cinco problemas y
cada uno tiene una respuesta distinta.

### 1. Identidad de las filas

Resuelto ya, por suerte. Todos los identificadores son UUID generados en el
equipo (`crypto.randomUUID`), así que dos terminales no pueden inventar el mismo
sin coordinarse. Las excepciones se tratan aparte:

| Tabla | Problema | Respuesta |
|---|---|---|
| `settings` | una sola fila, `id = 1` | no se sincroniza fila a fila; gana el último cambio explícito |
| `tables` | `number` es único | el salón se configura en un sitio y se replica; no se edita en dos a la vez |
| `product_recipe` | clave compuesta | el identificador de sincronización es `product_id/item_id` |

### 2. Capturar los cambios

Un **buzón de salida** (`sync_outbox`) que los triggers van llenando: qué tabla,
qué fila, si es alta/cambio o baja, y una copia en JSON. Es la única forma de no
depender de que cada pantalla se acuerde de anotar lo que toca.

### 3. No devolver el eco

Al aplicar un cambio que viene de otro terminal, los triggers volverían a
apuntarlo en el buzón y el cambio rebotaría entre equipos para siempre.

Se resuelve con una bandera en `sync_context`: el comando de Rust la levanta,
aplica los cambios y la baja, **todo dentro de la misma transacción y la misma
conexión**. Esto solo es fiable desde Rust; desde JavaScript no, porque el
plugin reparte cada llamada entre las conexiones de su pool.

### 4. Quién gana cuando dos cambian lo mismo

**No se comparan relojes.** Dos PC de un local llevan la hora que llevan, y una
diferencia de dos minutos bastaría para que el cambio bueno perdiera contra uno
viejo. El orden lo pone el servidor: cada cambio recibe un número al llegar, y
cada terminal pide «lo que haya después del número que ya tengo».

Dentro de ese orden, **gana el último en llegar** por fila. Es suficiente para
casi todo: la carta, los gastos, el inventario y los ajustes rara vez se tocan a
la vez en dos sitios.

### 5. Lo que de verdad choca: dos comandas en la misma mesa

El caso que sí ocurre a diario. Dos meseros abren la mesa 5 desde dos terminales
sin verse. En local el índice `one_live_order_per_table` lo impide, pero cada
equipo cree que es el único.

Aquí «gana el último» sería un desastre: una de las dos comandas desaparecería
con lo que el cliente ya se comió. La respuesta correcta es **fusionar**: se
queda la cuenta más antigua y las líneas de la otra se le pasan. Ninguna
comanda se pierde nunca; como mucho quedan juntas.

Esto hay que imponerlo en el servidor, porque es el único que ve las dos.

### 6. Lo calculado no se sincroniza

Los totales de la cuenta, el estado de la mesa y las existencias los calculan
triggers a partir de otras filas. Si además viajaran, se contarían dos veces:
el terminal receptor recibiría el movimiento de inventario del otro **y**
generaría el suyo al insertar la línea de comanda.

Por eso quedan fuera del buzón:

- `orders.subtotal_cents`, `tax_cents`, `total_cents`
- `tables.status`
- `inventory_items.stock_milli`
- los apuntes de `inventory_movements` con `order_item_id` — son los que nacen de
  una venta. Los manuales (compra, merma, ajuste, carga inicial) sí viajan.

Cada terminal los recalcula solo, y así llega al mismo número por su cuenta.

## Fases

### Fase 1 — el buzón · **hecha**

`004_sync_outbox.sql`: identidad del equipo, la bandera de aplicación, el buzón
y los triggers de las nueve tablas. **Apagado por defecto**: mientras
`sync_context.enabled` sea 0 los triggers no escriben nada, así que quien use un
solo equipo no paga ni un byte por esto.

Comprobado en `scripts/check-schema.mjs`: que apagado no encole, que encendido
sí, que aplicar no devuelva el eco y que lo calculado no viaje.

### Fase 2 — el servidor · **hecha**

`supabase/sync-server.sql`. Una tabla `changes` que guarda cambios en orden y
dos funciones, `sync_push` y `sync_pull`. El servidor **no replica el esquema
del POS**: así, cuando el POS cambie, no hay migración que coordinar entre
equipos.

El acceso no usa Supabase Auth. Cada local tiene una clave secreta —de la que
solo se guarda el hash— y el rol anónimo no puede tocar ninguna tabla, solo
ejecutar esas dos funciones. La clave pública de Supabase viaja dentro del
binario, como siempre, y por sí sola no sirve de nada.

### Fase 3 — subir y bajar · **hecha**

`src/features/sync/` y `src/providers/sync-provider.tsx`. Cada 30 segundos:
sube el buzón, pide lo nuevo desde el último número recibido y lo aplica.

Tres detalles que importan:

- **El buzón se vacía después de que el servidor confirme**, nunca antes. Si se
  corta la conexión a mitad, los cambios vuelven a salir. Repetir un cambio es
  inocuo —todos dicen «pon esta fila así»—; perderlo, no.
- **`last_seq` se guarda en la misma transacción que los cambios.** Por separado,
  un fallo entre medias dejaría al terminal repitiendo o, peor, saltándose
  cambios que no llegó a aplicar.
- **Lo que llega se filtra contra una lista blanca** (`features/sync/tables.ts`).
  Los nombres de tabla y columna no pueden ir como parámetros de una consulta,
  así que acaban concatenados en el SQL; sin ese filtro, cualquiera que hablase
  con el servidor podría escribir lo que quisiera en la base de este equipo. Es
  la única superficie de la aplicación que ejecuta SQL derivado de datos de red,
  y tiene sus propias pruebas en `scripts/check-sync.mjs`.

### Fase 4 — la fusión de comandas · **hecha**

`006_order_merge.sql` y `features/sync/merge-orders.ts`.

Lo que pasaba antes de esto era peor de lo previsto. El índice de una cuenta
viva por mesa **rechazaba** la segunda comanda, y como los cambios se aplican en
una transacción, el rechazo tumbaba el lote entero. `last_seq` no avanzaba y el
terminal reintentaba lo mismo cada treinta segundos para siempre: la
sincronización no se degradaba, moría.

La regla, en una línea: **gana la cuenta con `(created_at, id)` menor**, se lleva
las líneas de la otra, y la absorbida queda marcada con `merged_into`.

Lo que hace que funcione sin coordinar nada es que la regla es determinista. Los
dos terminales tienen las dos filas, aplican la misma comparación y llegan al
mismo resultado por su cuenta — por eso la fusión **no se apunta en el buzón**:
nadie tiene que anunciarla.

Cuatro detalles que costaron y no son obvios:

- **`merged_into` no tiene clave foránea.** Para absorber hay que dejar de estar
  viva la cuenta local *antes* de insertar la que gana, pero una clave foránea
  exigiría lo contrario. Las dos condiciones no se pueden cumplir a la vez.
- **La fusión se aplica en dos momentos.** Dejar de estar viva la absorbida va
  antes del lote; mover sus líneas va después, cuando la cuenta destino ya
  existe.
- **Las líneas que llegan tarde se redirigen solas**, dentro del SQL. Un
  terminal que estuvo días apagado sigue mandando líneas de una comanda que aquí
  ya se fusionó.
- **Las cadenas se aplanan.** Si aparece una cuenta aún más antigua, la que
  ganaba pasa a perder y lo que la apuntaba se repunta.

Comprobado en `scripts/check-sync.mjs` con dos bases independientes que reciben
el cambio de la otra: ambas eligen la misma ganadora, ninguna línea se pierde y
los dos totales coinciden. También el caso del terminal que se pone al día de
cero y recibe las dos comandas de golpe.

## Puesta en marcha

1. Crear un proyecto en Supabase y ejecutar `supabase/sync-server.sql` en su
   editor SQL.
2. Dar de alta el local y **guardar la clave**, que solo se enseña una vez:
   ```sql
   select * from public.create_venue('Mi restaurante');
   ```
3. En cada terminal: Ajustes › Sincronización. Pegar la dirección del proyecto,
   su clave pública (Project Settings › API › anon) y la clave del local del
   paso 2. Guardar y encender el interruptor.

El primer terminal sube todo lo que tenga en el buzón; los siguientes lo reciben
al arrancar. Antes de encender conviene que **todos** los PIN tengan seis
cifras: sus hashes viajan en el registro de cambios.

## Lo que falta comprobar

Las cuatro fases están escritas y verificadas pieza a pieza, incluida la
convergencia de la fusión entre dos bases independientes. Lo que **no** se ha
hecho es correrlo contra dos máquinas de verdad, con su red, sus cortes y sus
relojes. Eso queda pendiente y no lo sustituye ninguna prueba simulada.

Un par de cosas que solo se verán ahí:

- Qué pasa si un terminal se queda sin conexión a mitad de un cobro.
- Si treinta segundos entre sincronizaciones es poco o demasiado para el ritmo
  real del salón.
