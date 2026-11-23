# Impugnaciones

Tras responder una pregunta, el jugador puede pulsar **«⚑ Impugnar pregunta»**, escribir el motivo y enviarlo sin salir del juego.

## Cómo funciona

1. El juego manda la impugnación a la función `impugnar` de Supabase, en el proyecto **App PROPOLIS** (`auuotygakkegogssmaoy`, región eu-west-1).
2. La función la guarda en la tabla `impugnaciones` y avisa a un webhook de Make; un escenario envía el correo a oposicionesmunicipal@gmail.com desde esa misma cuenta de Gmail. (Alternativa: [Resend](https://resend.com).)
3. Si no hay conexión o el servidor falla, el juego abre el correo del jugador con el mensaje ya escrito, para que no se pierda.

El código está en el repositorio:

- Función: `supabase/functions/impugnar/index.ts`. Está desplegada sin verificación de JWT porque el juego no tiene usuarios, y se protege sola.
- Tabla: `supabase/migrations/20261121000000_crear_impugnaciones.sql`.
- Botón y envío en el juego: busca `IMPUGNAR_URL` en `index.html`.

## Protección

- La tabla tiene RLS activado y ninguna política: con la clave pública no se puede leer ni escribir. Solo escribe la función.
- Campo trampa oculto: si un robot lo rellena, la función responde «ok» y no guarda nada.
- Límites: 5 impugnaciones por hora desde el mismo origen y 60 por hora en total. No se guarda la IP, solo una huella anónima.
- Longitudes máximas en cada campo, comprobadas en la función y en la tabla.

## Correo con Make + Gmail (activo)

Ya está configurado y probado (22/11/2026): escenario «Patrullan2 - enviar impugnación» en Make y secreto `MAKE_WEBHOOK_URL` en Supabase. Si hubiera que rehacerlo:

La función avisa a un webhook de Make y un escenario envía el correo desde la propia cuenta de Gmail (sin dominio ni Resend).

1. En Make hay un webhook «Patrullan2 - impugnaciones» y un escenario que lo recibe y envía el correo con Gmail. Requiere conectar la cuenta de Gmail en Make.
2. En Supabase: **App PROPOLIS → Edge Functions → Secrets → Add new secret**: `MAKE_WEBHOOK_URL` = la URL del webhook (empieza por `https://hook.eu1.make.com/`).
3. Listo. Si Make falla y existe `RESEND_API_KEY`, se intenta con Resend.

## Alternativa: Resend (no se usa ahora)

Hasta que se configure, las impugnaciones **se guardan en la tabla pero no llega correo** (`correo_enviado = false`).

1. Crea una cuenta en [resend.com](https://resend.com) **con el correo oposicionesmunicipal@gmail.com**. Sin dominio propio, Resend solo puede escribir a la dirección de la cuenta, que es la que necesitamos.
2. En Resend: *API Keys → Create API Key* (permiso *Sending access*). Copia la clave (`re_…`).
3. En Supabase: proyecto **App PROPOLIS → Edge Functions → Secrets → Add new secret**. Nombre `RESEND_API_KEY`, valor la clave.
4. Listo: la siguiente impugnación ya llega por correo. No hace falta tocar el juego ni volver a desplegar la función.

Gratis: 100 correos al día y 3000 al mes.

Make gratuito: unas 1000 operaciones al mes; cada impugnación gasta 2.

Secretos opcionales: `IMPUGNAR_A` (otro destinatario), `IMPUGNAR_DE` (remitente, cuando haya dominio propio verificado en Resend) y `HASH_SAL`.

## Revisar las impugnaciones

En Supabase: **App PROPOLIS → Table Editor → impugnaciones**. Cada fila tiene el id de la pregunta (para buscarla en `data/preguntas/`), el motivo y un `estado` (`pendiente`, `aceptada`, `rechazada`) con su `nota_revision` para llevar el seguimiento.

Pendientes, de la más reciente a la más antigua:

```sql
select creada, pregunta_id, motivo, bloque, nivel
from impugnaciones where estado = 'pendiente' order by creada desc;
```

## Plan gratuito

Supabase pausa los proyectos gratuitos tras una semana sin actividad. Si App PROPOLIS se pausa, el juego no puede enviar y abre el correo del jugador. Para reactivarlo: panel de Supabase → proyecto → *Restore*.
