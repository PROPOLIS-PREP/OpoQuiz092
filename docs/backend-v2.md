# Backend de la v2 online

Backend de Supabase para Patrullan2 2.0.0: cuentas, amigos, grupos, presencia y partidas online.
La v1.0.0, local y publicada en Google Play, no usa nada de esto.

- **Proyecto:** `patrullan2-dev` (ref `nuktczrndortdfgtnzdy`, región eu-west-1, organización PROPOLIS, plan gratuito). Es solo de desarrollo; producción irá en otro proyecto.
- **Rama:** `v2-online`.
- **Migración:** `supabase/migrations/20261124100000_v2_online_base.sql`.
- **Edge Function:** `supabase/functions/delete_account/`.
- **Carga del banco:** `tools/cargar-preguntas.mjs`.
- **Prueba de seguridad:** `tests/rls.sql`.

## Estado

| Paso | Estado |
|---|---|
| Proyecto `patrullan2-dev` | Creado |
| Migración | **Sin aplicar**: la herramienta la rechazó dos veces. Hay que aplicarla (ver «Puesta en marcha») |
| Banco de preguntas | Sin cargar: necesita la migración y la clave secreta en `.env.local` |
| Edge Function `delete_account` | Escrita, sin desplegar |
| Tipos TypeScript | Sin generar: se generan cuando exista el esquema |
| Avisos de seguridad (advisors) | Sin revisar: dependen del esquema |
| Autenticación | Valores por defecto del proyecto nuevo (ver «Autenticación») |

## Credenciales

- `.env.local`, en `.gitignore`, lleva `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`, que son públicas y pueden ir al frontend.
- `SUPABASE_SECRET_KEY` (clave secreta o service_role) solo la usan scripts locales como `tools/cargar-preguntas.mjs`. **Nunca va al frontend ni al repositorio.** Se copia a mano de *Project Settings → API Keys*.
- `.env.example` es la plantilla, sin valores.

## Tablas

| Tabla | Para qué | Lectura (authenticated) | Escritura desde el cliente |
|---|---|---|---|
| `profiles` | Perfil público | Todos, solo `id, username, display_name, avatar_url, last_seen_at` | Cada uno su `username`, `display_name`, `avatar_url`, `last_seen_at` |
| `friendships` | Solicitudes, amistades y bloqueos | Solo sus dos participantes | Ninguna: solo por RPC |
| `groups` | Grupos | Solo sus miembros | Ninguna: solo por RPC |
| `group_members` | Miembros y rol (`admin`, `member`) | Solo miembros del grupo | Ninguna: solo por RPC |
| `questions` | Banco con la respuesta correcta | **Nadie** | Ninguna |
| `matches` | Partidas | Solo sus jugadores | Ninguna: solo por RPC |
| `match_players` | Jugadores, puntos, categoría y orden | Solo jugadores de la partida | Ninguna: solo por RPC |
| `match_questions` | Pregunta de cada turno y sus plazos | **Nadie** | Ninguna |
| `match_answers` | Respuestas | Jugadores de la partida | Insertar la propia, en tu turno y con la partida en curso |

`anon` no tiene permiso sobre ninguna tabla ni función. RLS está activo en todas las tablas y no hay ninguna política abierta.

Detalles:
- **`profiles.username`:** único sin distinguir mayúsculas, de 3 a 20 caracteres, letras, números y guion bajo. `username_provisional` es `true` hasta que el usuario lo cambia; no es público, y cada uno lo ve con `my_profile()`.
- **`friendships`:** un solo registro por par (índice único sobre el par ordenado) y nunca consigo mismo. En las filas `blocked`, `requester_id` es quien bloquea.
- **`matches.code`:** 5 caracteres en mayúsculas sin ambiguos (sin I, L, O, 0 ni 1). `join_match` acepta minúsculas.

Como `profiles` limita columnas, las consultas del cliente deben nombrarlas: `.select("id, username, display_name, avatar_url, last_seen_at")`. Un `select("*")` falla por falta de permiso.

## Funciones (RPC)

Todas son `security definer` con `search_path` vacío, exigen sesión y solo las puede ejecutar `authenticated`.

| Función | Qué hace |
|---|---|
| `my_profile()` | Tu perfil completo, incluido `username_provisional` |
| `send_friend_request(username)` | Envía la solicitud. Si el otro ya te la había enviado, queda aceptada. Falla si hay bloqueo |
| `respond_friend_request(id, accept)` | Solo el destinatario. Aceptar la marca `accepted`; rechazar la borra |
| `remove_friend(id)` | Quita una amistad, cancela una solicitud o desbloquea (esto último solo quien bloqueó) |
| `block_user(user_id)` | Bloquea a un usuario. Sustituye cualquier relación previa con él |
| `create_group(name)` | Crea el grupo; quien lo crea es propietario y `admin` |
| `invite_to_group(group_id, username)` | Solo admins. Añade al usuario como `member`, salvo bloqueo |
| `remove_group_member(group_id, user_id)` | Solo admins; no se puede quitar al propietario |
| `leave_group(group_id)` | Sales del grupo. Si eras propietario, pasa al admin más antiguo o, si no hay, al miembro más antiguo. Si no queda nadie, el grupo se borra |
| `create_match(mode, max_players, turns)` | `mode`: `points` o `ladder`; de 2 a 5 jugadores; de 1 a 30 turnos por jugador. Devuelve `match_id` y `code` |
| `join_match(code)` | Entras en una partida del lobby que no esté llena. Si ya estabas, devuelve la misma |
| `leave_match(match_id)` | Sales del lobby. Si eras anfitrión, lo pasa a ser el siguiente; si no queda nadie, se borra |
| `start_match(match_id)` | Solo el anfitrión, con 2 jugadores o más. Fija `total_questions = turns × jugadores` y reparte la primera pregunta |
| `get_current_question(match_id)` | La pregunta en juego, sin la respuesta. Si la pide el jugador activo, empiezan sus 25 s |
| `submit_answer(match_id, question_index, option)` | Responde en tu turno. Devuelve si aciertas, los puntos, la respuesta correcta, la explicación y tu total |
| `get_question_result(match_id, question_index)` | Resultado de una pregunta **ya cerrada**: correcta, elegida, explicación y puntos |

`prepare_account_deletion(user_id)` solo la puede ejecutar `service_role` y la usa la Edge Function `delete_account`.

### Reglas de partida

- **Turnos:** el orden lo marca la entrada en la partida (`seat`). La pregunta `i` es del jugador en la posición `i mod jugadores`.
- **Tiempo:** el jugador activo tiene **25 s** desde que ve la pregunta (`get_current_question`). Si no la abre en **15 s** desde que se reparte, se cierra igual. Ese margen cubre el panel de revisión de la pregunta anterior, que el cliente cierra solo a los 10 s.
- **Cierre:** la pregunta se cierra al responder o al vencer el plazo. Sin respuesta cuenta como fallo (`result = 'timeout'`). Entonces se reparte la siguiente sin esperar a nadie.
- **Puntos:** un acierto vale tantos puntos como el nivel de la pregunta (1 a 7). Un fallo o no responder vale 0.
- **Nivel:** en `points` es aleatorio de 1 a 7. En `ladder` depende de la categoría del jugador (`match_players.categoria`, de 0 Policía a 6 Comisario Principal), con los mismos pesos que la v1: cuanto más alta la categoría, más preguntas difíciles.
- **Elección de pregunta:** primero se sortea el bloque, como la ruleta, y después una pregunta de ese nivel que no haya salido en la partida.
- **Sin temporizador en el servidor:** los plazos vencidos se cierran cuando alguien llama a `get_current_question`, `submit_answer` o `get_question_result`. El cliente debe llamar a `get_current_question` cuando su cuenta atrás llegue a cero.
- **Doble vía de respuesta:** las respuestas se validan y puntúan en triggers de `match_answers`. Responder con `submit_answer` o con un insert directo da el mismo resultado. La política de insert solo deja la respuesta propia, en tu turno y con la partida en curso.
- **Panel de revisión:** es del cliente. Al cambiar `matches.current_index`, todos piden `get_question_result` de la anterior y lo muestran 10 s como máximo.

## Realtime y presencia

Están publicadas en `supabase_realtime`: `friendships`, `group_members`, `matches`, `match_players` y `match_answers`. Realtime aplica RLS, así que cada cliente solo recibe los cambios de filas que puede leer.

```js
// Cambios de la partida: nueva pregunta (current_index), fin (status), puntos, respuestas
supabase.channel(`partida:${matchId}`)
  .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, alCambiar)
  .on("postgres_changes", { event: "*", schema: "public", table: "match_players", filter: `match_id=eq.${matchId}` }, alCambiar)
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "match_answers", filter: `match_id=eq.${matchId}` }, alCambiar)
  .subscribe();
```

La presencia (quién está en línea) **no usa tablas**: va con Realtime Presence, que vive en memoria del servidor de Realtime y desaparece al desconectarse.

```js
// Presencia global: quién está conectado ahora mismo
const canal = supabase.channel("presencia", { config: { presence: { key: miPerfil.id } } });
canal
  .on("presence", { event: "sync" }, () => {
    const enLinea = Object.keys(canal.presenceState());   // ids de usuario conectados
    pintarAmigosEnLinea(enLinea);
  })
  .subscribe(async (estado) => {
    if (estado === "SUBSCRIBED") await canal.track({ username: miPerfil.username, en: "menu" });
  });

// Dentro de una partida, un canal por partida: sirve para marcar «desconectado» en la sala
const sala = supabase.channel(`sala:${matchId}`, { config: { presence: { key: miPerfil.id } } });
```

- Al entrar en la app, cada cliente hace `track()` en el canal `presencia`. Para mostrar amigos en línea se cruza `presenceState()` con la lista de amistades.
- `profiles.last_seen_at` es para mostrar «visto hace…». La actualiza el propio cliente: al abrir la app y cada pocos minutos.
- `match_players.connected` queda para un uso futuro. Hoy la conexión real se ve con Presence en el canal `sala:<id>`.
- **Privacidad:** los canales públicos de Presence los puede escuchar cualquier usuario con la clave publicable. Para la v2 basta, porque solo se publica el id y el username, que ya son públicos. Si se quiere restringir, Realtime Authorization (canales privados con políticas en `realtime.messages`) queda pendiente.

## Autenticación

- **Correo con confirmación:** en un proyecto nuevo, el proveedor Email viene activo y exige confirmar el correo. No lo he podido comprobar ni cambiar desde mis herramientas. Revísalo en *Authentication → Sign In / Providers → Email* («Confirm email» activado).
- **URL del sitio y redirecciones:** en *Authentication → URL Configuration*, pon la URL de la v2 y las de desarrollo (por ejemplo `http://localhost:5173`).
- **Google:** queda pendiente de credenciales. Hace falta, desde Google Cloud Console:
  1. Un proyecto en Google Cloud y la pantalla de consentimiento OAuth: nombre de la app, correo de soporte, logotipo, dominio autorizado y enlace a la política de privacidad.
  2. Un ID de cliente OAuth de tipo «Aplicación web», con:
     - **Orígenes de JavaScript autorizados:** la URL de la v2.
     - **URI de redirección autorizado:** `https://nuktczrndortdfgtnzdy.supabase.co/auth/v1/callback`.
  3. El **Client ID** y el **Client Secret** se pegan en *Authentication → Sign In / Providers → Google*. El secreto no se pasa por el chat ni va al repositorio.
  4. Para la app Android (TWA) no hace falta otro cliente si el inicio de sesión ocurre en la web.
- **Perfil al registrarse:** el trigger `on_auth_user_created` crea el perfil con un username provisional `agente_xxxxxxxx` y `username_provisional = true`. El `display_name` sale del nombre de Google, si lo hay, o es «Agente». El cliente debe obligar a cambiar el username mientras `my_profile().username_provisional` sea `true`.

## Borrar la cuenta

`POST https://nuktczrndortdfgtnzdy.supabase.co/functions/v1/delete_account` con `Authorization: Bearer <access_token>`.

1. Comprueba la sesión.
2. Llama a `prepare_account_deletion`, que sale de los grupos (cediendo la propiedad si hace falta) y pasa el anfitrión de sus partidas sin terminar a otro jugador.
3. Borra el usuario de Auth. Por cascada se borran el perfil, las amistades, las membresías, los puestos en partidas y las respuestas.

Se despliega con `verify_jwt = true`.

## Puesta en marcha

1. **Aplicar la migración.** Pega `supabase/migrations/20261124100000_v2_online_base.sql` en el *SQL Editor* de `patrullan2-dev` y ejecútalo, o deja que Claude la aplique.
2. **Cargar el banco.** Copia la clave secreta en `SUPABASE_SECRET_KEY` de `.env.local` y ejecuta `node tools/cargar-preguntas.mjs`. Carga 6254 preguntas activas; las marcadas `revisar` se quedan fuera. Es idempotente: repítelo cuando cambie el banco.
3. **Desplegar `delete_account`.**
4. **Revisar los advisors** de seguridad y rendimiento.
5. **Generar los tipos** en `supabase/database.types.ts`.

## Cómo probar

- **RLS:** ejecuta `tests/rls.sql` entero en el SQL Editor. Crea tres usuarios de prueba (A, B y C) y comprueba lo siguiente:
  - C no ve la amistad, el grupo, la partida ni las respuestas de A y B.
  - Nadie edita el perfil de otro.
  - Nadie lee `questions` ni `match_questions`.
  - La respuesta correcta no sale antes de cerrar la pregunta.
  - Nadie responde por otro.
  - `anon` no accede a nada.

  Termina en `ROLLBACK`, así que no deja datos. Si todo va bien, el último aviso es «TODOS LOS TESTS OK».
- **Datos:** `node tools/cargar-preguntas.mjs --seco` cuenta las preguntas sin cargar nada.

## Pendientes y decisiones abiertas

- **Subir de categoría en `ladder`:** en la v1 se asciende con méritos y examen en Comisaría. Online, `match_players.categoria` existe pero nadie la cambia todavía. Falta decidir la regla, por ejemplo cada N aciertos o tras un examen, y escribir la función que la aplique.
- **Preguntas de casilla:** en la v1, al caer en una casilla de temario sale una pregunta extra de nivel aleatorio. El tablero online (dado, casillas, cartas) no está en este backend. Cuando se haga, hará falta otro tipo de pregunta en `match_questions`.
- **Invitar a un grupo:** hoy añade al usuario directamente. Decidir si debe aceptar primero o si solo se puede invitar a amigos.
- **Abandonar una partida en curso** y qué pasa con sus turnos: hoy siguen repartiéndose y se cierran por tiempo.
- **Limpieza** de partidas del lobby abandonadas y de partidas terminadas antiguas.
- **Realtime Authorization** para canales de Presence privados.
- **Proyecto de producción:** crearlo cuando la v2 esté lista y aplicarle la misma migración.
