# Seguridad — x1Aoshy POS

Estado tras el paso a base de datos local (migraciones `001` y `002`).

## Qué cambió respecto a la versión anterior

La aplicación ya no habla con ningún servicio remoto. Con eso desaparece de
golpe toda una familia de riesgos —clave pública dentro del binario, políticas
RLS, registro abierto de cuentas, tráfico interceptable— porque ya no hay API a
la que llamar. También desaparece la protección que daban: **ahora no hay un
servidor que diga que no.**

## Dónde está la frontera real

```
%APPDATA%\com.restaurant.pos\pos.db
```

Un fichero SQLite **sin cifrar**. Quien pueda leerlo, puede leerlo todo: ventas,
cuentas, inventario y personal. Quien pueda escribirlo, puede cambiar cualquier
cifra sin pasar por la aplicación.

Lo único que lo protege son los permisos de la cuenta de Windows. Esa es la
frontera de seguridad, y conviene decirlo con todas las letras:

- **Una cuenta de Windows por persona que deba ver los datos.** Si el equipo del
  salón tiene una sesión compartida, todo el mundo tiene acceso total al
  fichero, mire lo que mire dentro de la aplicación.
- **Bloquea la sesión al ausentarte.** El PIN de la aplicación no sobrevive al
  reinicio de la ventana, pero el fichero sigue ahí.
- **Cifrado de disco (BitLocker)** si el equipo puede salir del local o
  perderse. Es la única medida que protege los datos con el equipo apagado.

## Los roles organizan, no protegen

`admin`, `manager`, `waiter` y `cashier` deciden **qué se ve en la interfaz**.
No son un control de acceso: cualquiera con acceso al fichero se salta la
aplicación entera. La pantalla de Usuarios lo dice explícitamente en vez de
sugerir una garantía que no existe.

Esto no es un descuido que quede por arreglar: sin servidor, no hay forma de
imponerlo. Un control de acceso real requiere que alguien que no seas tú guarde
los datos.

## Lo que sí protege la aplicación

**Los PIN no se guardan en claro.** `pbkdf2$210000$sal$hash`, PBKDF2-SHA256 con
210 000 iteraciones (recomendación OWASP), sal aleatoria por usuario y
comparación en tiempo constante. Alguien que abra el fichero no obtiene los PIN;
solo puede intentar romperlos, y a 210 000 iteraciones eso cuesta.

**La sesión no se guarda en disco.** Cerrar la aplicación obliga a introducir el
PIN otra vez. No hay «recordar sesión» que copiar.

**Los importes no se escriben desde la interfaz.** Los totales los calculan
triggers de SQLite a partir de producto y cantidad. Protege de errores, no de un
atacante — que edite el fichero directamente —, pero es la diferencia entre una
caja que cuadra y una que no.

**El libro de inventario no se reescribe.** Los movimientos se añaden; corregir
es añadir un asiento de ajuste. Queda rastro de todo.

**Los permisos de Tauri están acotados.** La aplicación solo puede escribir
ficheros en Documentos, Descargas y Escritorio —lo justo para guardar un
ticket— y solo puede abrir rutas de esas mismas carpetas. No tiene permiso de
red ni de shell.

## Abierto

### CSP desactivada — MEDIO

`tauri.conf.json` tiene `"csp": null`. Un intento anterior de restringirla dejó
la ventana en negro tras instalar, porque la política solo se aplica en el
binario compilado y `tauri dev` nunca la ejerce.

El riesgo real es bajo: la ventana carga únicamente recursos propios empaquetados
y no hay contenido de terceros ni entrada remota. Aun así conviene reactivarla y
**probarla sobre el instalador, no en desarrollo**.

### Sin copia de seguridad automática — ALTO en la práctica

El riesgo más probable de esta aplicación no es un atacante: es un disco que
falla. Ver `DEPLOY.md`, sección de copias.

### El buzón de sincronización lleva los hashes de PIN — A TENER EN CUENTA

`sync_outbox` incluye `staff.pin_hash`, porque sin él nadie podría entrar en un
terminal nuevo. Hoy no sale del equipo: la sincronización está construida solo
hasta el buzón y viene apagada.

En el momento en que se monte el servidor (fase 2 de `SYNC.md`) eso deja de ser
un detalle: pasa a haber hashes de PIN en un sistema de terceros. Son PBKDF2 con
210 000 iteraciones, no PIN en claro, pero un PIN de cuatro cifras tiene diez mil
combinaciones y eso se prueba entero. Antes de encender la sincronización
conviene exigir seis cifras como mínimo.

### El fichero no está cifrado — ACEPTADO

Existe SQLCipher, pero la clave tendría que vivir en el mismo equipo para que la
aplicación arranque sola, así que solo detiene a quien se lleve el disco y no el
resto. BitLocker cubre ese caso mejor y sin tocar la aplicación.
