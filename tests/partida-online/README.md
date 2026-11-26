# Pruebas de la partida online (subfase 3c)

`dos-motores.cjs` arranca **dos motores reales** (el `<script>` de `index.html` más `online/partida.js`), cada uno en su contexto `vm` con el DOM simulado de `tests/motor-semilla/simulador.cjs`, y los conecta a `servidor-falso.cjs`: un servidor en memoria con las mismas reglas que las funciones SQL de la partida (`submit_action`, `draw_question`, `get_current_question`, `use_lifeline`, `submit_answer`, `get_question_result`, `heartbeat`, `claim_forfeit`, `leave_match`, `report_result`), un registro de jugadas con su número de orden y avisos de «Realtime» con retraso. Los dos motores comparten un reloj virtual.

Cada móvil tiene una «persona» que decide con su propio azar y solo cuando le toca: responde (a veces fuera de plazo), usa comodines, acepta o rechaza el examen y el servicio de distrito, compra en comisaría, lanza cartas, despliega y recoloca efectivos.

## Escenarios

1. **Partidas completas 1 contra 1** (6 semillas de 5 turnos y 5 semillas de 15 turnos con efectivos y sirenas): los dos móviles terminan con el mismo estado y las mismas trazas, `report_result` coincide y el servidor cierra como `completed`. Comprueba además que quien no responde ve el mismo enunciado y las mismas opciones en solo lectura, sin la opción correcta, y que si intenta responder no sale nada hacia el servidor; que el perfil local no cambia y que se usan todas las jugadas (`tirar`, `desplegar`, `fin_despliegue`, `examen`, `distrito`, `comprar`, `fin_comisaria`, `lanzar`, `recolocar`, `sirena`, `comodin`, `pregunta`, `resultado`).
2. **Abandono** con `leave_match`: gana el rival y los dos motores se detienen.
3. **Desconexión**: el rival deja de enviar latidos; a los 60 s aparece «Reclamar victoria» y `claim_forfeit` (solo al pulsarlo) da la victoria.
4. **Control negativo**: el motor B recibe otra semilla a escondidas. La partida nunca termina con un resultado falso `completed`: o el motor detecta una jugada inesperada, o el servidor cierra como `disputed`, o los dos se quedan esperándose (bloqueo; ver «Pendientes» en `docs/backend-v2.md`).
5. **Modo local**: sin partida online, `estado.online` es `null` y `jugYo()` es el jugador 0.

## Cómo se ejecuta

Desde la raíz del repositorio, sin dependencias:

```
node tests/partida-online/dos-motores.cjs
```

Tarda unos 20 segundos y termina con `TODO OK` o con la lista de fallos (código de salida 1).

La prueba SQL de las mismas funciones contra la base de datos real está en `tests/partida-online.sql` (con `ROLLBACK`).
