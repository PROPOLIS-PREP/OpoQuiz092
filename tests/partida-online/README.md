# Pruebas de la partida online (subfase 3c)

`dos-motores.cjs` arranca **dos motores reales** (el `<script>` de `index.html` más `online/partida.js`), cada uno en su contexto `vm` con el DOM simulado de `tests/motor-semilla/simulador.cjs`, y los conecta a `servidor-falso.cjs`: un servidor en memoria con las mismas reglas que las funciones SQL de la partida (`submit_action`, `draw_question`, `get_current_question`, `use_lifeline`, `submit_answer`, `get_question_result`, `heartbeat`, `claim_forfeit`, `leave_match`, `report_result`), un registro de jugadas con su número de orden y avisos de «Realtime» con retraso. Los dos motores comparten un reloj virtual.

Cada móvil tiene una «persona» que decide con su propio azar y solo cuando le toca: responde (a veces fuera de plazo), usa comodines, acepta o rechaza el examen y el servicio de distrito, compra en comisaría, lanza cartas, despliega y recoloca efectivos.

## Escenarios

1. **Partidas completas 1 contra 1** (6 semillas de 5 turnos y 5 semillas de 15 turnos con efectivos y sirenas): los dos móviles terminan con el mismo estado y las mismas trazas, `report_result` coincide y el servidor cierra como `completed`. Comprueba además que quien no responde ve el mismo enunciado y las mismas opciones en solo lectura, sin la opción correcta, y que si intenta responder no sale nada hacia el servidor; que el perfil local no cambia y que se usan todas las jugadas (`tirar`, `desplegar`, `fin_despliegue`, `examen`, `distrito`, `comprar`, `fin_comisaria`, `lanzar`, `recolocar`, `sirena`, `comodin`, `pregunta`, `resultado`).
1c. **Pregunta del rival a la vista, con personas realistas** (9 semillas): cada persona actúa a los 1,2 s aunque haya animaciones, no toca la revisión ni las cartas del rival y responde en 0,8–2,3 s. Por tipo (turno, casilla, examen) y en los dos sentidos (anfitrión → invitado e invitado → anfitrión), el que mira ve el enunciado, las opciones desactivadas y «X está respondiendo…» antes de la respuesta, sin la opción correcta. Sin la puesta al día del motor, las de casilla se veían 0 de 10.
2. **Abandono** con `leave_match`: gana el rival y los dos motores se detienen.
3. **Desconexión**: el rival deja de enviar latidos; a los 60 s aparece «Reclamar victoria» y `claim_forfeit` (solo al pulsarlo) da la victoria.
4. **Control negativo**: el motor B recibe otra semilla a escondidas. La partida nunca termina con un resultado falso `completed`: o el motor detecta una jugada inesperada, o el servidor cierra como `disputed`, o los dos se quedan esperándose (bloqueo; ver «Pendientes» en `docs/backend-v2.md`).
5. **Modo local**: sin partida online, `estado.online` es `null` y `jugYo()` es el jugador 0.
6. **Arranque que falla**: `entrar()` devuelve el error real y cierra el canal de Realtime.
7. **Inactividad**: a los 60 s sin actividad cuando la pantalla espera al jugador, «Vas a perder por inactividad en 5…»; a 0 pierde; un toque la cancela; el rival puede reclamar con `claim_inactivity` (con algo pendiente, 60 s; sin nada, 180 s); sin la migración, la derrota funciona igual y el rival no ve el botón. Comprueba además que `mark_activity` lleva `p_pendiente` tanto con una acción pendiente (sin renovar la actividad) como esperando al rival.
9. **Solo los botones de acción cuentan**: B, en su turno, solo arrastra, amplía y toca zonas vacías del tablero durante 60 s: sale la cuenta atrás a los 60 s, pierde a los 65 s y todo lo que envía lleva `p_actividad = false`. Con la misma partida, B pulsa un botón de acción a los 30 s: se envía `p_actividad = true`, no sale la cuenta atrás y la partida termina con normalidad.
8. **Aviso de salida**: «Volver al cuartel» u «Otra partida» avisan al rival una sola vez (broadcast), sin tapar los puntos.
10. **Revancha** (servidor falso con las reglas de `request_rematch`): A pulsa «Otra partida» y espera («Esperando a tu rival…», el botón desactivado); B ve «Tu rival quiere la revancha»; cuando B pulsa se crea una sola partida y los dos entran en ella, sin arrancar el modo local. Si B se va a «Jugar en local», A ve «Tu rival ha decidido jugar en modo local» y el botón vuelve. A los 2 minutos sin respuesta, «La revancha ha caducado». Con 3 partidas activas, «Ya tienes 3 partidas a la vez…».

## Cómo se ejecuta

Desde la raíz del repositorio, sin dependencias:

```
node tests/partida-online/dos-motores.cjs
```

Tarda unos 20 segundos y termina con `TODO OK` o con la lista de fallos (código de salida 1).

La prueba SQL de las mismas funciones contra la base de datos real está en `tests/partida-online.sql` (con `ROLLBACK`).
