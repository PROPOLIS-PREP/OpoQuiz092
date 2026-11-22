# Cambios

## v14.9 · 2026-11-22 · App instalable en el móvil

- Nuevos `manifest.webmanifest`, `sw.js` (service worker, también permite abrir sin conexión lo ya visitado) e `icons/` (192, 512, maskable y apple-touch). Con ello Chrome ofrece «Instalar app» en lugar de solo «Añadir acceso directo», y Safari usa el icono propio al añadir a la pantalla de inicio.
- Para forzar la renovación de lo guardado en los móviles, sube `VERSION` en `sw.js`.

## v14.8 · 2026-11-22 · Bancos de tráfico, ordenanzas y social, y correo de impugnaciones

- Nuevos bancos: `bloque-trafico.json` (773 activas, temas 28 a 32), `bloque-ordenanzas.json` (885, temas 13 a 19) y `bloque-social.json` (685, temas 35 a 40). Los seis bloques de la ruleta tienen ya preguntas: 6254 activas en total. Las casillas de Ordenanzas y Social dejan de usar preguntas de otro bloque.
- 1691 enunciados de tráfico, ordenanzas y social citan ahora la norma («Según la Ordenanza del Taxi, …», «Según la LPRL (Ley 31/1995…), …»). Las normas están en `tools/lib/normas.mjs`. Quedan sin cita 405 preguntas de contenido de estudio sin una norma única (tipos de accidente, fisiología del alcohol, conceptos de Derecho Administrativo…).
- 110 preguntas marcadas `revisar` quedan fuera del juego hasta revisarlas (15 legislativo, 8 policial, 8 tráfico, 20 penal, 7 ordenanzas y 52 social).
- Las impugnaciones llegan por correo: la función `impugnar` avisa a un webhook de Make y un escenario envía el correo desde la cuenta de Gmail de la academia. Resend queda como alternativa.

## v14.7 · 2026-11-21 · Banco de preguntas del bloque penal

- Nuevo `data/preguntas/bloque-penal.json`: 1394 preguntas de los temas 20 a 27 y del Anexo PMM (Poder Judicial y proceso penal, y Código Penal). Entran 1374 en el juego; las 20 marcadas `revisar` (organización judicial de la LO 1/2025) quedan fuera.
- El sector Penal de la ruleta y sus casillas (Chamartín y Usera) ya sacan preguntas propias. Aparece el objetivo diario «Acierta 3 de Penal».
- 1230 enunciados penales citan ahora la norma (Código Penal, LOPJ, LECrim, LO del Jurado, de habeas corpus, de menores…); 113 ya la citaban. No se cita en 11 preguntas cuya respuesta es la propia norma ni en 40 de doctrina o sin norma concreta.
- `tools/citar-ley.mjs` reconoce las normas penales, las fuentes de examen («Examen PROPOLIS · Tema N · …») y los temas que son siempre de una misma norma.

## v14.6 · 2026-11-21 · Los enunciados citan la ley

- Botón «Impugnar pregunta» en el panel de resultado, tras acertar o fallar. Pide el motivo y lo envía sin salir del juego a la función `impugnar` de Supabase (proyecto App PROPOLIS), que lo guarda en la tabla `impugnaciones` y lo manda a oposicionesmunicipal@gmail.com con Resend: motivo, id, bloque, nivel, enunciado, opciones (con la correcta y la marcada) y explicación. Si no hay conexión, abre el correo del jugador con el mensaje escrito. Detalles en `docs/impugnaciones.md`.
- 1754 enunciados de los bloques legislativo y policial dicen ahora la norma a la que se refieren («Según la LOPSC (LO 4/2015), …», «Según el temario de la LOTC (LO 2/1979), …»). 552 ya la citaban.
- No se cita en 64 preguntas cuya respuesta es la propia norma o un artículo suyo, para no darla, ni en 190 cuya fuente es genérica (sobre todo de los temas 3, 4, 6 y 7) y no consta una norma concreta. Para verlas: `node tools/citar-ley.mjs`.
- Nueva herramienta `tools/citar-ley.mjs`, para aplicar lo mismo a los próximos bloques.

## v14.5 · 2026-11-20 · Banco de preguntas del bloque policial

- Las preguntas de casilla (distrito, Juzgado y cartas de acción) tienen nivel al azar, del 1 al 7. Solo la pregunta obligatoria del turno depende de la categoría del jugador (y el examen, de la categoría a la que se opta). Si no quedan preguntas del nivel sorteado en el bloque de la casilla, sale el nivel más cercano.
- Nuevo `data/preguntas/bloque-policial.json`: 1253 preguntas de los temas 8 a 12, 33 y 34 (Reglamento PMM, LO 4/2010, Ley 1/2018, Reglamento Marco, LOFCS y LO 4/2015). Entran 1245 en el juego; las 8 marcadas `revisar` quedan fuera.
- El sector Policial de la ruleta y sus casillas (Gran Vía y Vallecas) ya sacan preguntas propias. Aparece el objetivo diario "Acierta 3 de Policial".
- Nuevo campo `gemela`: marca dos preguntas que preguntan lo mismo. En una partida solo sale una de cada grupo, igual que las de enunciado idéntico, y el validador ya no avisa de que repitan enunciado.

## v14.4 · 2026-11-20 · Ruleta y tablero con los seis bloques

- La ruleta tiene un sector por bloque del temario: Legislativo, Policial, Tráfico, Penal, Ordenanzas y Social, cada uno con su color e icono.
- El tablero tiene 2 casillas por bloque (12). La casilla que sobraba, Chamberí, pasa a ser de acción (ahora hay 4).
- La casilla de la ruleta y del tablero la decide el bloque de la pregunta (el campo `bloque` del archivo). El campo `b` (CE, EAM, LRBRL) queda como materia informativa.
- Mientras un bloque no tenga preguntas, la ruleta lo avisa y sale una pregunta de otro bloque; en su casilla, la pregunta extra también sale de otro bloque.
- Los objetivos diarios de bloque se generan solos para los bloques que tienen preguntas (hoy, "Acierta 3 de Legislativo").

## v14.3 · 2026-11-20 · Avatar con imágenes

- El avatar pasa a ser una sola imagen compuesta con 32 piezas ilustradas: 2 agentes, 6 fondos de Madrid, 6 gorras y cascos, 6 accesorios, 6 marcos y 6 peanas. La cabeza asoma por encima del marco.
- El hueco "Peinado" se sustituye por "Agente" (agente con gorra de plato o agente con boina).
- Se retiran las piezas antiguas dibujadas en SVG que no tienen imagen: peinados, barba, gafas de estudio, medalla, gorra de faena, gorra de gala, sin gorra, casco de caballería, fondos de cielo, damero, noche y dorado, marco diamante y peanas de mármol y de mérito. Quien las tuviera recupera su precio una vez; las de recompensa se cambian por su equivalente (marco de temporada → marco damero, peana de mérito → holográfica, marco de oro → peana dorada).
- Recompensas: "Plaza en propiedad" da la peana holográfica, "Número uno de la promoción" la peana dorada y la pista de temporada el marco damero. "Compañerismo dudoso" y "Álbum completo" dan monedas y sobres.
- Imágenes originales en `assets/avatar/`, posiciones en `data/avatar.json` y herramienta de optimización `tools/avatar.py`.

## v14.2 · 2026-11-19 · Banco de preguntas del bloque legislativo

- Nuevo `data/preguntas/bloque-legislativo.json`: 1307 preguntas de los temas 1 a 7 (Constitución, Estatuto CM, Derecho Administrativo, Régimen local y ROGA), en las categorías CE (630), EAM (201) y LRBRL (461).
- Se actualizan las preguntas sobre las cuatro reformas constitucionales y la representación separada de Ibiza y Formentera.
- Las preguntas extra de distrito conservan su categoría y bajan al nivel inferior disponible más cercano cuando se agota el nivel sorteado.
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
