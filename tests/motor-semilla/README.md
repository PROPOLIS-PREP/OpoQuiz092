# Pruebas del motor con semilla

Comprueban la subfase 3b de la v2: las decisiones de la partida usan `rngJuego`, que en el modo local es `Math.random` y en una partida online es `semilla(String(seed))` (vía `iniciar(modo, {semilla})` → `fijarSemilla`).

No necesitan dependencias ni navegador. `simulador.cjs` ejecuta el `<script>` de un `index.html` dentro de un contexto `vm` de Node con:

- un DOM mínimo simulado (elementos permisivos, sin pintar nada),
- temporizadores virtuales instantáneos,
- `Math.random` sustituido por un generador fijo que anota quién lo llama,

y juega una partida local completa de 4 bots y 6 rondas. Cuando la partida espera una pulsación («Continuar» de una pregunta o de una carta, botón de acción), la pulsa como lo haría una persona.

## Las pruebas

- **A · Equivalencia del modo local.** Con 20 semillas fijas de `Math.random`, juega la misma partida con el `index.html` de referencia (motor anterior, con `Math.random` directo) y con el actual. La traza de decisiones (carta de evento, ruleta, pregunta, respuesta, dado, cartas, resultado final), la secuencia de llamadas a `Math.random` y el resultado final deben ser idénticos.
- **B · Determinismo con semilla.** Con `iniciar("rapida", {semilla: S})`, dos partidas con `Math.random` distinto deben dar la misma traza y el mismo final; semillas distintas, trazas distintas; y con semilla ninguna función de decisión llama a `Math.random`. El tiempo que tarda un bot en contestar se fija en esta prueba (`esperaBotFija`): es un tiempo, no una decisión, pero los puntos de un acierto dependen de los segundos que sobran (base + segundos × 8). En las partidas online ese tiempo tendrá que salir del servidor.
- **C · Revisión del código.** Comprueba que ninguna función de decisión usa `Math.random`, `azar()` ni `barajar()` (salvo el tiempo de espera de `turnoBot`), que `descartarDos` (50/50) y el álbum siguen con `Math.random`, y que `confeti`, `generarLiga`, `avAzar`, `perfilNuevo` y `addAmigo` no han cambiado.

## Cómo se ejecuta

Desde la raíz del repositorio:

```
node tests/motor-semilla/pruebas.cjs
```

Por defecto compara el `index.html` del commit `e93fb6d` (el último antes de la 3b, que se extrae con `git show e93fb6d:index.html` a un archivo temporal) con el `index.html` actual. Con eso, la prueba A sigue teniendo sentido aunque haya commits nuevos. No se usa `HEAD~1` porque, a partir del commit que añade estas pruebas, `HEAD~1` ya contiene el motor con semilla y la comparación sería trivial.

Otras formas:

```
node tests/motor-semilla/pruebas.cjs --base <commit>        # otro commit de referencia
node tests/motor-semilla/pruebas.cjs antes.html despues.html
```

Tarda unos 25 segundos (unas 50 partidas completas). Termina con `TODO OK` o con la lista de fallos y código de salida 1.

Si un cambio futuro del juego hace que la prueba A falle, es lo esperado cuando ese cambio altera las decisiones a propósito: en ese caso hay que usar `--base` con un commit que ya tenga ese comportamiento.
