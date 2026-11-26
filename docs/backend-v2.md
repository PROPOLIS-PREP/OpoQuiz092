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
| Cliente online (motor con semilla y capa de red) | Sin empezar (ver «Lo que falta en el cliente») |

## Cómo funciona una partida online

La partida online es **la misma que la local**: tablero, fichas, ruleta, casillas, cartas de acción y de evento, efectivos, méritos, convocatorias y exámenes de ascenso, escalafón, rachas, escudos, comodines y puntuación. Para no duplicar esas reglas, se usa un modelo *lockstep*:

1. **Mismo motor en cada móvil.** Cada jugador ejecuta el motor del modo local.
2. **Misma semilla.** Al empezar, el servidor fija una semilla (`matches.seed`). Todo el azar del motor (dado, ruleta, cartas, nivel de la pregunta, efectos) sale de un generador con esa semilla, así que todos los móviles obtienen los mismos números.
3. **Mismo registro de jugadas.** Cada decisión de un jugador (tirar el dado, elegir objetivo, desplegar efectivos, presentarse al examen…) se anota en `match_actions` con un número de orden. Todos los motores aplican las mismas jugadas en el mismo orden y llegan al mismo estado.
4. **El servidor guarda lo que no puede quedar en el cliente:**
   - las preguntas y sus respuestas;
   - el tiempo de cada pregunta;
   - la validación de las respuestas;
   - el 50/50, que necesita saber cuáles son las falsas;
   - el +10 s;
   - los abandonos;
   - el resultado final.

   Lo que hace el servidor también queda en el registro (`pregunta`, `resultado`, `comodin`, `abandono`, `fin`), así que los motores lo aplican como una jugada más.

Ventajas: las reglas existen una sola vez, en el motor local, y cualquier cambio vale para los dos modos. Nadie puede ver la respuesta correcta antes de tiempo ni falsear un acierto.

Límite: el servidor no comprueba las reglas del tablero, como si a alguien le tocaba tirar o si tenía el comodín. Eso lo hacen los motores: una jugada imposible la descartan todos igual, así que un cliente trucado no consigue nada. Los resultados finales de cada motor se comparan (`report_result`).

### Ascenso en modo `ladder`

Igual que en local, lo lleva el motor:
- el jugador acumula méritos;
- cuando sale una convocatoria y tiene los méritos de la categoría siguiente (3 para Oficial, 7 para Subinspector…), se presenta al examen;
- si aprueba, asciende;
- la categoría fija el nivel de la pregunta de turno.

Las preguntas del examen las reparte el servidor como cualquier otra, con `draw_question(…, tipo => 'examen')`.

### Preguntas

- **Quién la pide:** el motor de quien debe responder llama a `draw_question(match, bloque, nivel, segundos, tipo)`.
  - El **bloque** sale de la ruleta o de la casilla.
  - El **nivel**, de la categoría o de forma aleatoria en las casillas, como en local.
  - Los **segundos** son 25 de base y cambian con el radar, el examen o las cartas.
  - El **tipo** es `turno`, `casilla` o `examen`.

  El servidor elige una pregunta de ese bloque y nivel que no haya salido en la partida y anota la jugada `pregunta`. Los demás motores comprueban que bloque, nivel y segundos son los que tocaban.
- **10 segundos para abrirla.** Desde que se reparte, el jugador tiene 10 s para abrirla. Se abre al llamar a `get_current_question`, y en ese momento empieza su tiempo de respuesta. Si no la abre a tiempo, cuenta como fallo.
- **Cierre:** al responder (`submit_answer`) o al vencer el tiempo (fallo, `timeout`). El servidor anota la jugada `resultado` con el acierto o el fallo, y los motores la aplican: puntos, dado, racha…
- **Panel de revisión:** es del cliente. Con `get_question_result` todos ven la respuesta correcta y la explicación. Cada uno lo cierra con Continuar, o se cierra solo a los 10 s, y no bloquea la partida.
- **Comodines con servidor:** `use_lifeline`.
  - `mitad`: el 50/50 o la carta Chivatazo. Quita opciones falsas hasta dejar dos.
  - `tiempo`: suma 10 s.

  La sirena y los multiplicadores los aplica el motor.

### Abandono

- **Quien abandona pierde automáticamente.**
  - Con `leave_match` en una partida en curso.
  - Por desconexión: si un jugador pasa 60 s sin enviar `heartbeat`, cualquier rival puede reclamar su abandono con `claim_forfeit`.
- **Si quedan dos jugadores,** al abandonar uno gana el otro y la partida termina (`finish_reason = 'forfeit'`).
- **Si quedan más,** la partida sigue y los motores saltan los turnos del que se fue (jugada `abandono`).

### Final

Al acabar los turnos, cada motor envía su resultado con `report_result(match, {usuario: puntos})`. Cuando lo han enviado todos los que siguen en la partida:
- **si coinciden,** se guardan los puntos y gana el que más tiene (`completed`; con empate, sin ganador);
- **si no coinciden,** la partida termina como `disputed`.

`report_result` (y los abandonos, por `private.forfeit`) **solo cierra la partida**: `completed`, `forfeit` o `disputed`. No escribe puntos del marcador, monedas ni logros; eso llega en la 3d (ver «Modelo de la 3d y la 3e»).

## Credenciales

- `.env.local`, en `.gitignore`, lleva `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`, que son públicas y pueden ir al frontend.
- `SUPABASE_SECRET_KEY` (clave secreta o service_role) solo la usan scripts locales como `tools/cargar-preguntas.mjs`. **Nunca va al frontend ni al repositorio.** Se copia a mano de *Project Settings → API Keys*.
- `.env.example` es la plantilla, sin valores.

## Tablas

| Tabla | Para qué | Lectura (authenticated) | Escritura desde el cliente |
|---|---|---|---|
| `profiles` | Perfil público | Todos, solo `id, username, display_name, avatar_url, last_seen_at` | Cada uno su `username`, `display_name`, `avatar_url`, `last_seen_at` |
| `friendships` | Solicitudes, amistades y bloqueos | Solo sus dos participantes | Ninguna: solo por RPC |
| `groups` | Grupos | Sus miembros y quien tenga invitación | Ninguna: solo por RPC |
| `group_members` | Miembros y rol (`admin`, `member`) | Solo miembros del grupo | Ninguna: solo por RPC |
| `group_invitations` | Invitaciones pendientes | El invitado y los admins del grupo | Ninguna: solo por RPC |
| `questions` | Banco con la respuesta correcta | **Nadie** | Ninguna |
| `matches` | Partidas, semilla, ganador | Solo sus jugadores | Ninguna: solo por RPC |
| `match_players` | Jugadores, orden, abandono, latido, puntos finales | Solo jugadores de la partida | Ninguna: solo por RPC |
| `match_actions` | Registro de jugadas | Solo jugadores de la partida | Ninguna: solo por RPC |
| `match_questions` | Preguntas repartidas, plazos y comodines | **Nadie** | Ninguna |
| `match_answers` | Respuestas | Jugadores de la partida | Insertar la propia, en su pregunta abierta y con la partida en curso |

`anon` no tiene permiso sobre ninguna tabla ni función. RLS está activo en todas las tablas y no hay ninguna política abierta.

Detalles:
- **`profiles.username`:** único sin distinguir mayúsculas, de 3 a 20 caracteres, letras, números y guion bajo. `username_provisional` es `true` hasta que el usuario lo cambia; no es público, y cada uno lo ve con `my_profile()`.
- **`friendships`:** un solo registro por par (índice único sobre el par ordenado) y nunca consigo mismo. En las filas `blocked`, `requester_id` es quien bloquea.
- **`matches.code`:** 5 caracteres en mayúsculas sin ambiguos (sin I, L, O, 0 ni 1). `join_match` acepta minúsculas.
- **`match_actions.payload`:** 4 KB como máximo. Los tipos `inicio`, `pregunta`, `resultado`, `comodin`, `abandono` y `fin` los anota solo el servidor.

Como `profiles` limita columnas, las consultas del cliente deben nombrarlas: `.select("id, username, display_name, avatar_url, last_seen_at")`. Un `select("*")` falla por falta de permiso.

## Funciones (RPC)

Todas son `security definer` con `search_path` vacío, exigen sesión y solo las puede ejecutar `authenticated`.

**Perfil y amigos** (la amistad exige que el otro acepte)

| Función | Qué hace |
|---|---|
| `my_profile()` | Tu perfil completo, incluido `username_provisional` |
| `send_friend_request(username)` | Envía la solicitud. Si el otro ya te la había enviado, queda aceptada (los dos la quieren). Falla si hay bloqueo |
| `respond_friend_request(id, accept)` | Solo el destinatario. Aceptar la marca `accepted`; rechazar la borra |
| `remove_friend(id)` | Quita una amistad, cancela una solicitud o desbloquea (esto último solo quien bloqueó) |
| `block_user(user_id)` | Bloquea a un usuario. Sustituye cualquier relación previa y anula las invitaciones a grupos entre los dos |

**Grupos** (solo se invita a amigos, y el invitado tiene que aceptar)

| Función | Qué hace |
|---|---|
| `create_group(name)` | Crea el grupo; quien lo crea es propietario y `admin` |
| `invite_to_group(group_id, username)` | Solo admins y solo a amigos suyos. Crea una invitación pendiente |
| `respond_group_invitation(group_id, accept)` | El invitado acepta (entra como `member`) o rechaza |
| `cancel_group_invitation(group_id, user_id)` | Un admin retira una invitación |
| `remove_group_member(group_id, user_id)` | Solo admins; no se puede quitar al propietario |
| `leave_group(group_id)` | Sales del grupo. Si eras propietario, pasa al admin más antiguo o, si no hay, al miembro más antiguo. Si no queda nadie, el grupo se borra |

**Partidas**

| Función | Qué hace |
|---|---|
| `create_match(mode, max_players, turns)` | `mode`: `points` o `ladder`; de 2 a 5 jugadores; de 1 a 30 turnos. Devuelve `match_id` y `code` |
| `join_match(code)` | Entras en una partida del lobby que no esté llena. Si ya estabas, devuelve la misma |
| `start_match(match_id)` | Solo el anfitrión, con 2 jugadores o más. Fija la semilla y anota `inicio` con el orden de los jugadores |
| `leave_match(match_id)` | En el lobby, sales. En curso, **abandonas y pierdes** |
| `heartbeat(match_id)` | Latido del cliente, cada ~15 s mientras juega |
| `claim_forfeit(match_id, user_id)` | Da por abandonado a un rival con 60 s o más sin latido |
| `submit_action(match_id, expected_seq, kind, payload)` | Anota una jugada del motor. Si `expected_seq` no es la siguiente, falla con `40001`: el cliente lee las jugadas nuevas y vuelve a decidir |
| `draw_question(match_id, bloque, nivel, segundos, tipo)` | Reparte una pregunta al jugador que la pide y anota `pregunta` |
| `get_current_question(match_id)` | La pregunta en juego, sin la respuesta. Si la pide quien responde, se abre y empieza su tiempo |
| `use_lifeline(match_id, question_index, kind)` | `mitad` (devuelve las opciones quitadas) o `tiempo` (+10 s). Una vez cada uno por pregunta |
| `submit_answer(match_id, question_index, option)` | Responde tu pregunta abierta. Devuelve si aciertas, la correcta y la explicación |
| `get_question_result(match_id, question_index)` | Resultado de una pregunta **ya cerrada**, para todos los jugadores |
| `report_result(match_id, scores)` | Resultado final que calculó tu motor: `{ "<user_id>": puntos, … }` |

`prepare_account_deletion(user_id)` solo la puede ejecutar `service_role` y la usa la Edge Function `delete_account`.

**Sin temporizador en el servidor:** los plazos vencidos se cierran cuando alguien llama a una función de la partida, como `heartbeat`, `get_current_question` o `submit_action`. Con el latido cada 15 s, ningún plazo queda abierto más de unos segundos de más.

## Realtime y presencia

Están publicadas en `supabase_realtime`:
- `friendships`, `group_members` y `group_invitations`;
- `matches`, `match_players`, `match_actions` y `match_answers`.

Realtime aplica RLS, así que cada cliente solo recibe lo que puede leer. **`match_actions` es el canal principal de la partida.**

```js
// Jugadas de la partida: cada fila nueva se aplica al motor, en orden de seq
supabase.channel(`partida:${matchId}`)
  .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "match_actions", filter: `match_id=eq.${matchId}` },
      ({ new: jugada }) => motor.recibir(jugada))   // si falta alguna seq, leer las que faltan con un select
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

// Dentro de una partida, un canal por partida para mostrar quién está conectado en la sala
const sala = supabase.channel(`sala:${matchId}`, { config: { presence: { key: miPerfil.id } } });
```

- Al entrar en la app, cada cliente hace `track()` en el canal `presencia`. Para mostrar amigos en línea se cruza `presenceState()` con la lista de amistades.
- Presence sirve para mostrar quién está en la sala. **El abandono no depende de Presence**, sino del latido (`heartbeat`) guardado en el servidor, que no se puede falsear desde otro cliente.
- `profiles.last_seen_at` es para mostrar «visto hace…». La actualiza el propio cliente: al abrir la app y cada pocos minutos.
- **Privacidad:** los canales públicos de Presence los puede escuchar cualquier usuario con la clave publicable. Para la v2 basta, porque solo se publica el id y el username, que ya son públicos. Restringirlos con Realtime Authorization queda pendiente.

## Autenticación

- **Correo con confirmación:** en un proyecto nuevo, el proveedor Email viene activo y exige confirmar el correo. No lo he podido comprobar ni cambiar desde mis herramientas. Revísalo en *Authentication → Sign In / Providers → Email* («Confirm email» activado).
- **URL del sitio y redirecciones:** en *Authentication → URL Configuration*, pon la URL de la v2 y las de desarrollo (por ejemplo `http://localhost:5173`).
- **Google:** queda pendiente de credenciales. Hace falta, desde Google Cloud Console:
  1. Un proyecto en Google Cloud y la pantalla de consentimiento OAuth: nombre de la app, correo de soporte, logotipo, dominio autorizado y enlace a la política de privacidad.
  2. Un ID de cliente OAuth de tipo «Aplicación web», con:
     - **Orígenes de JavaScript autorizados:** la URL de la v2.
     - **URI de redirección autorizado:** `https://nuktczrndortdfgtnzdy.supabase.co/auth/v1/callback`.
  3. El **Client ID** y el **Client Secret** se pegan en *Authentication → Sign In / Providers → Google*. El secreto no se pasa por el chat ni va al repositorio.
- **Perfil al registrarse:** el trigger `on_auth_user_created` crea el perfil con un username provisional `agente_xxxxxxxx` y `username_provisional = true`. El `display_name` sale del nombre de Google, si lo hay, o es «Agente». El cliente debe obligar a cambiar el username mientras `my_profile().username_provisional` sea `true`.

## Borrar la cuenta

`POST https://nuktczrndortdfgtnzdy.supabase.co/functions/v1/delete_account` con `Authorization: Bearer <access_token>`.

1. Comprueba la sesión.
2. Llama a `prepare_account_deletion`:
   - sale de los grupos, cediendo la propiedad si hace falta;
   - abandona sus partidas en curso, así que las pierde;
   - pasa el anfitrión de sus partidas en el lobby.
3. Borra el usuario de Auth. Por cascada se borra el resto de sus datos.

Se despliega con `verify_jwt = true`.

## Lo que falta en el cliente

El backend está listo para el modelo lockstep, pero el juego todavía no lo usa. Para la v2 hace falta:
1. **Azar con semilla.** Sustituir `Math.random()` del motor (dado, ruleta, cartas, `sortearNivel`, `sacarPesada`, `barajar`, `azar`…) por un generador con semilla. Las animaciones pueden seguir con `Math.random()` porque no cambian el estado.
2. **Separar decisiones de efectos.** Cada decisión de un jugador se convierte en una jugada (`submit_action`), y el motor solo avanza al aplicar jugadas del registro, también las propias.
3. **Preguntas del servidor.** El motor pide la pregunta con `draw_question` y aplica el `resultado` del registro en lugar de comprobar la respuesta en local. De momento el `index.html` sigue llevando el banco local con las respuestas (ver «Pendientes»).
4. **Comodines.** El 50/50 y el Chivatazo usan `use_lifeline('mitad')`, y el +10 s usa `use_lifeline('tiempo')`.
5. **Pantallas nuevas:** inicio de sesión, perfil y nombre de usuario, amigos, grupos, crear o unirse a una partida con código, sala de espera, latido, abandono y resultado final.
6. **Sin bots** en las partidas online: los rivales controlados por la máquina del modo local no participan.

## Puesta en marcha

1. **Aplicar la migración.** Pega `supabase/migrations/20261124100000_v2_online_base.sql` en el *SQL Editor* de `patrullan2-dev` y ejecútalo, o deja que Claude la aplique.
2. **Cargar el banco.** Copia la clave secreta en `SUPABASE_SECRET_KEY` de `.env.local` y ejecuta `node tools/cargar-preguntas.mjs`. Carga 6254 preguntas activas; las marcadas `revisar` se quedan fuera. Es idempotente: repítelo cuando cambie el banco.
3. **Desplegar `delete_account`.**
4. **Revisar los advisors** de seguridad y rendimiento.
5. **Generar los tipos** en `src/lib/supabase-types.ts`.

## Cómo probar

- **RLS:** ejecuta `tests/rls.sql` entero en el SQL Editor. Crea tres usuarios de prueba (A, B y C) y comprueba lo siguiente:
  - **Amistades:** solo se aceptan con el sí del otro.
  - **Grupos:** solo se invita a amigos y hay que aceptar.
  - **Intrusa:** C no ve la amistad, el grupo, la partida, las jugadas ni las respuestas de A y B.
  - **Perfiles:** nadie edita el de otro.
  - **Preguntas:** nadie lee `questions` ni `match_questions`, y la respuesta correcta no sale antes de cerrar.
  - **Respuestas:** nadie responde por otro.
  - **Registro de jugadas:** mantiene el orden.
  - **50/50:** quita dos opciones falsas.
  - **Abandono:** quien abandona pierde y gana el rival.
  - **anon:** no accede a nada.

  Termina en `ROLLBACK`, así que no deja datos. Si todo va bien, el último aviso es «TODOS LOS TESTS OK».
- **Datos:** `node tools/cargar-preguntas.mjs --seco` cuenta las preguntas sin cargar nada.

## Partida online en el cliente (3c, hecha)

- **Archivos:** `online/partida.js` (puente con Supabase) y, en `index.html`, el modo online del motor. `online/partidas.js` activa «Empezar»: solo el anfitrión, con el rival en la sala y en su lista de amigos (comprobación de la app). Quien mira la sala cuando empieza entra solo; si no, con «Entrar».
- **Arranque:** el puente lee el registro desde la jugada 0 (`inicio`: semilla, turnos y jugadores por asiento) y llama a `iniciar("online", {semilla, online})`. La semilla se fija antes de la primera decisión.
- **Lockstep:** cada decisión de una persona es una jugada (`submit_action` con el número esperado) y el motor solo avanza cuando la jugada vuelve del registro, también las propias. Jugadas: `tirar`, `desplegar`, `fin_despliegue`, `examen`, `distrito`, `comprar`, `fin_comisaria`, `lanzar`, `recolocar`, `sirena`. El 50/50 y el +10 s van por `use_lifeline` (jugada `comodin`), y la respuesta por `submit_answer` (jugada `resultado`). Las jugadas imposibles las descartan los dos motores igual.
- **Jugador de este móvil:** `jugYo()` sustituye a «el jugador 0». En local devuelve el 0; online, el del asiento. En el motor, `p.remoto` marca al rival.
- **Preguntas:** quien responde llama a `draw_question` con el bloque, el nivel y los segundos que calcula su motor; el otro motor comprueba que la jugada `pregunta` coincide con lo suyo y, si no, la partida se detiene por desincronización. `get_current_question` abre la pregunta. La respuesta correcta solo llega con `get_question_result`, cuando la pregunta está cerrada (lo que devuelve `submit_answer` no se usa). Los puntos salen de `segundos_restantes` de la jugada `resultado`.
- **Lo que ve el rival:** «X está respondiendo…» y, al cerrarse, la revisión con la respuesta. Nunca la pregunta mientras se responde. La revisión se cierra sola a los 10 s; las cartas de un solo botón del turno del rival, a los 3,5 s (solo marcan el ritmo de cada móvil).
- **Latido y abandono:** `heartbeat` cada 15 s. Una barra arriba indica si el rival está conectado, si lleva tiempo sin jugar o si no da señal; a los 60 s sin latido aparece «Reclamar victoria» (`claim_forfeit`, solo al pulsarlo). «Salir» durante la partida es abandonar (`leave_match`).
- **Final:** pantalla con los puntos de cada jugador, sin premios; `report_result` solo cierra la partida (`completed`, `forfeit` o `disputed`). Durante una partida online no se ejecutan `hito()`, `regMax()` ni los premios de `finPartida()`, y el perfil local no cambia.
- **Pruebas:** `tests/partida-online.sql` (RPC, RLS y que nadie lee la respuesta antes de responder), `tests/partida-online/dos-motores.cjs` (dos motores reales con un servidor falso) y `tests/motor-semilla` (el modo local no cambia).

## Plan de subfases del cliente online

- **3c · Partida online.** Tablero, turnos, semilla (`iniciar(modo, {semilla})`) y tiempo del servidor. Al terminar, `report_result` solo cierra la partida. No da monedas, puntos del marcador, trofeos ni progreso de retos, y no escribe en el perfil local: en una partida online, `hito()`, `regMax()` y el reparto de premios de `finPartida()` no se ejecutan.
- **3d · Final de partida.** Marcador de puntos, monedas de la partida, pantalla de fin y tratamiento de las partidas `disputed`.
- **3e · Perfil online.** Avatar visible para todos, accesorios comprados con monedas del servidor, ligas por tramos del marcador y logros online calculados en el servidor.

El modo local no cambia: sus monedas, trofeos, retos y liga simulada siguen en el móvil. La única conexión es el traspaso de monedas, una sola vez, al entrar en la cuenta por primera vez.

## Modelo de la 3d y la 3e (propuesta, sin migraciones)

Todas las tablas llevan RLS. El cliente solo lee; escriben únicamente funciones `security definer` del servidor.

### Configuración

- **`public.game_config`**: `clave` (texto, clave primaria), `valor` (jsonb), `updated_at`. La leen los usuarios con sesión y se cambia desde el panel, sin tocar código. Valores previstos:
  - `puntos_1v1`: `{"ganador": 30, "perdedor": -5}`. El abandono cuenta como derrota.
  - `ligas`: `[{"nombre": "Sin liga", "desde": 0}, {"nombre": "Bronce", "desde": 100}, {"nombre": "Plata", "desde": 200}, {"nombre": "Oro", "desde": 300}]`.
  - `monedas`: cantidades y límites, **pendientes** (ver abajo).

### Marcador de puntos (3d)

Sin Elo y sin temporadas: un marcador permanente que empieza en 0.

- **`public.scores`**: `user_id` (clave primaria), `puntos` (entero, empieza en 0), `partidas`, `ganadas`, `perdidas`, `updated_at`. La leen los usuarios con sesión (clasificación general).
- **`public.score_changes`**: `match_id`, `user_id`, `antes`, `despues`, `delta`, `resultado` (`win`, `loss`, `draw`), `created_at`. Clave primaria `(match_id, user_id)`: una partida nunca puntúa dos veces. Cada jugador lee los suyos.
- **Cuándo se aplica:** desde `private.finish_match`, por donde pasan todos los finales.
  - `completed` con ganador: el ganador suma `ganador` (+30) y el perdedor suma `perdedor` (−5).
  - `forfeit`: quien abandona, como perdedor; el rival, como ganador.
  - `disputed`: no cambia nada.
- **Saldo mínimo 0:** `despues = greatest(0, antes + delta)` y `delta` guarda el cambio real (**propuesta pendiente de confirmar**).
- **Pendientes:** empate en 1 contra 1 (`completed` sin ganador) y partidas de 3 o más jugadores. No se implementan hasta decidirlo.

### Ligas (3e)

Calculadas a partir de `scores.puntos` con los tramos de `game_config.ligas`, sin tabla propia: una función `public.liga_de(puntos)` o una vista de clasificación con `username`, `puntos` y `liga`. Tramos: Sin liga 0–99, Bronce 100–199, Plata 200–299, Oro desde 300.

### Monedas (3d)

Una sola cuenta de monedas por usuario, en el servidor. Se ganan jugando en local y en online.

- **`public.wallets`**: `user_id` (clave primaria), `monedas` (entero, `check (monedas >= 0)`), `traspaso_local_at` (timestamptz, null hasta el traspaso), `updated_at`. Solo la lee su dueño.
- **`public.coin_movements`**: `id`, `user_id`, `delta`, `motivo` (`traspaso_local`, `partida_online`, `partida_local`, `compra`, `logro`, `ajuste`), `match_id`, `item_id`, `origen` (texto libre del cliente, por ejemplo el id de la partida local), `created_at`. Es el libro de movimientos; `wallets.monedas` es su suma ya calculada.
  - Índice único `(user_id, match_id)` cuando `motivo = 'partida_online'`: una partida online se cobra una sola vez.
- **Traspaso de las monedas locales (una sola vez):**
  - La función `import_local_coins(p_monedas)` comprueba que `wallets.traspaso_local_at` es null, apunta un movimiento `traspaso_local` y pone `traspaso_local_at = now()` en la misma transacción.
  - Además, un índice único `(user_id)` cuando `motivo = 'traspaso_local'` impide un segundo traspaso aunque se llame dos veces a la vez.
  - En el móvil, el perfil local guarda `traspasoCuenta = <user_id>` para no volver a ofrecerlo y deja de mostrar el saldo local como propio.
  - Si el usuario entra desde un segundo móvil, ese móvil ya no puede traspasar: el servidor lo rechaza porque la cuenta ya tiene traspaso.
- **Cantidades y límites: pendientes.** Las columnas y los motivos quedan previstos, sin valores: cuánto da una partida online, cuánto una local, tope del traspaso y límite diario.

### Logros (3e)

Dos conjuntos separados: los **locales** siguen en el móvil sin cambios, y los **online** viven en el servidor.

- **`public.achievements`**: `id`, `nombre`, `descripcion`, `metrica` (por ejemplo `victorias_online`), `objetivo`, `premio_monedas` (puede ser 0), `activo`.
- **`public.user_progress`**: `user_id`, `metrica`, `valor`, con clave primaria `(user_id, metrica)`. Solo métricas online: ganar X en local y ganar X en online son progresos distintos, y el progreso local sigue en el móvil.
- **`public.user_achievements`**: `user_id`, `achievement_id`, `conseguido_at`.
- Los concede el servidor (desde `private.finish_match` y `buy_item`). El cliente no puede concederlos.
- **Lista inicial: pendiente.**

### Avatar y accesorios (3e)

- **`profiles.avatar_config`** (jsonb): la combinación de piezas (`agente`, `fondo`, `gorra`, `extra`, `marco`, `figura`, `base`). Se añade al permiso de lectura de columnas de `profiles` para los usuarios con sesión y **no** al de escritura: solo se cambia con `set_avatar`. `avatar_url` deja de usarse.
- **`public.items`**: catálogo con `id` (el de la pieza en el juego), `tipo`, `precio` (0 = gratis), `activo`. Lo leen los usuarios con sesión.
- **`public.user_items`**: `user_id`, `item_id`, `adquirido_at`, con clave primaria `(user_id, item_id)`. Solo lo lee su dueño.
- **`set_avatar(config)`:** comprueba que cada pieza existe y es gratuita (`precio = 0`) o está en `user_items`, y guarda `avatar_config`. El cliente lo llama al entrar en la cuenta (sube el avatar del móvil) y en cada cambio. Si alguna pieza no es válida, se rechaza y se avisa.
- **`buy_item(item_id)`:** en una sola transacción comprueba saldo, que la pieza esté activa y que no la tenga ya; apunta el movimiento `compra` y añade la pieza a `user_items`.
- **Piezas básicas gratis** (las del perfil local nuevo): **propuesta pendiente de confirmar**.

## Pendientes y decisiones abiertas

- **Hecho (3c): migración `20261125120000_resultado_segundos_restantes.sql`, aplicada en `patrullan2-dev` el 2026-11-25.** `private.close_question` añade a la jugada `resultado` los `segundos_restantes` en décimas (`round(floor(extract(epoch from (closes_at − now())) * 10) / 10, 1)`, 0 en `timeout`), para que los dos motores calculen los mismos puntos de la partida que el modo local. Probada con rollback (acierto con 12,37 s → 12.3; +10 s → 35.0; plazo vencido → 0) y `tests/rls.sql` sigue pasando.
- **Jugador inactivo pero conectado (3d).** Si el rival no juega pero sigue enviando latidos, la partida espera. En la 3c la app solo avisa de que el rival lleva tiempo sin jugar.
- **Respuestas en el cliente (antes de la beta pública).** El `index.html` lleva el banco local con la respuesta correcta de cada pregunta, así que en una partida online se podría buscar el enunciado y ver la respuesta. Se acepta mientras las partidas sean entre amigos. Antes de la beta pública habrá que servir el modo online sin respuestas en el cliente.
- **Partidas `disputed`:** qué hacer cuando los motores no coinciden en el resultado. Hoy terminan sin ganador.
- **Desincronización que acaba en bloqueo (3d).** Si los dos motores dejan de coincidir (por ejemplo, dos versiones distintas del juego en los móviles), puede que cada uno espere una jugada del otro y ninguno juegue: solo se ve el aviso de rival inactivo. Propuesta: que cada móvil anote al entrar la versión de su motor y una huella del estado en cada jugada, para detenerlo en cuanto no coincidan.
- **Reconexión (3d):** si se recarga la página a mitad de partida, el motor se pierde. Al volver a entrar, el puente repasa el registro desde el principio sin repetir llamadas al servidor, pero falta probarlo y pasar rápido las pantallas ya vistas.
- **Limpieza** de partidas del lobby abandonadas y de partidas terminadas antiguas.
- **Realtime Authorization** para canales de Presence privados.
- **Proyecto de producción:** crearlo cuando la v2 esté lista y aplicarle la misma migración.

### Revisar antes de la beta (detectados en la fase 2 del cliente, amigos)

- **El bloqueado puede saber que le han bloqueado.** La política de lectura de `friendships` deja ver la fila a los dos participantes, así que quien ha sido bloqueado ve la fila `status = blocked` con el otro como `requester_id`. La app la oculta (`online/amigos.js`, `clasificar`), pero se puede leer con la clave publicable y una sesión. Arreglo posible: que la política excluya las filas `blocked` cuando `addressee_id = auth.uid()`.
- **Avisos Realtime al borrar filas de `friendships`.** Los `DELETE` de Realtime no pasan por RLS: llegan a todos los suscritos a la tabla, solo con el `id` de la fila (sin datos personales). El cliente recarga sus listas al recibir cualquier cambio. Con muchos usuarios conectados es ineficiente. Alternativas: canales privados con Realtime Authorization o avisos por canal de usuario (broadcast) desde las RPC.

### Reglas del lobby que hoy solo controla la app (subfase 3a, `online/partidas.js`)

Pendientes de llevar al backend antes de la beta: quien llame a las RPC directamente con la clave publicable y una sesión puede saltárselas.

- **Máximo 3 partidas simultáneas por jugador** (en sala de espera o en curso). `create_match` y `join_match` no lo comprueban; `tests/partidas.sql` deja constancia de que el backend permite una cuarta.
- **Solo partidas contra amigos.** La app solo deja crear una partida eligiendo a un amigo, avisa si en la sala hay alguien que no lo es y solo deja empezar (`start_match`, 3c) si el rival es amigo, pero `join_match` y `start_match` aceptan a cualquiera que tenga el código. Arreglo posible: que `join_match` exija amistad aceptada con el anfitrión (y quizá un `invited_user` en `matches`).
- **Cierre de salas de espera de más de 30 minutos.** Lo hace cada cliente al abrir la lista (sale con `leave_match`; la sala se borra cuando no queda nadie). Si nadie la abre, la sala sigue en la base de datos. Arreglo posible: una tarea programada (pg_cron) que borre las salas `lobby` antiguas.
