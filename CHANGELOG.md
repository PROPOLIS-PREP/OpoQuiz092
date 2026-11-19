# Cambios

## v14.2 · 2026-11-19 · Banco de preguntas del bloque legislativo

- Nuevo `data/preguntas/bloque-legislativo.json`: 1307 preguntas de los temas 1 a 7 (Constitución, Estatuto CM, Derecho Administrativo, Régimen local y ROGA), en las categorías CE (630), EAM (201) y LRBRL (461).
- Las 15 preguntas marcadas `revisar` se validan pero no entran en el juego: quedan 1292 activas.
- Se eliminan las 63 preguntas de prueba de la v14 (Constitución, Estatuto CM y Régimen local).
- Nombre, color y orden de las categorías se definen en `data/categorias.json`. Los archivos de preguntas son ahora un archivo por bloque del temario, preparado para los bloques policial, tráfico, penal, ordenanzas y social.
- El juego admite preguntas de 3 opciones. El 50/50 deja siempre dos opciones (quita una falsa si hay tres) y los rivales simulados ya no eligen una opción inexistente.
- El validador acepta 3 o 4 opciones, comprueba que los `id` no se repitan y que cada `b` exista en `categorias.json`.

## v14.1 · 2026-11-19 · Reorganización del repositorio

- `patrulla-092-v14.html` pasa a llamarse `index.html`.
- Los datos salen del código a `data/`:
  - Preguntas, un archivo por bloque en `data/preguntas/` (`constitucion.json`, `estatuto-cm.json`, `lrbrl.json`).
  - Tablero en `data/casillas.json`, escalafón en `data/escalafon.json` y cartas de evento en `data/cartas-evento.json`.
- Lo que hace cada carta de evento sigue en el código (`EFECTOS_EVENTO`), enlazado por el campo `efecto` de la carta.
- `tools/build.mjs` copia `data/` dentro de `index.html`, que sigue siendo un único archivo que se abre sin servidor.
- `tools/validar.mjs` revisa las preguntas: 4 opciones, respuesta de 0 a 3, nivel de 1 a 7, duplicados y cobertura por nivel.
- Tests de datos y partidas simuladas de sorteo de preguntas en `tests/`.
- Documentación en `docs/`: reglas, guía de preguntas, fuentes legales y política de privacidad (borrador).
- Validación automática en GitHub Actions.
- Sin cambios de juego: los datos generados son idénticos a los de v14.

## v14

- Identidad de PROPOLIS en la pantalla de inicio.
- 63 preguntas provisionales (21 por bloque, 3 por nivel).

Las versiones anteriores a v14 no están documentadas.
