# Patrulla 092

Juego de preguntas y tablero para opositores a Policía Municipal de Madrid, en la línea de Preguntados y Monopoly. Cada jugador contesta test del temario, tira el dado y avanza por un plano de Madrid para ganar puntos, ascender en el escalafón y reclutar efectivos.

Es un prototipo jugable de las mecánicas. Incluye los bancos reales de los bloques legislativo (1292 preguntas activas) y policial (1245). Los rivales, la liga y los amigos están simulados.

## Cómo se abre

Todo el juego está en un único archivo: `index.html`.

1. Descarga el archivo.
2. Ábrelo con cualquier navegador moderno (Chrome, Edge, Safari, Firefox).
3. Para jugar desde el móvil, súbelo a cualquier alojamiento estático (por ejemplo, GitHub Pages) y abre el enlace.

No hace falta instalar nada ni tener conexión, salvo para cargar la tipografía de Google Fonts. El progreso se guarda en el propio navegador (localStorage), así que cada dispositivo tiene su perfil.

## Cómo se juega

- Eliges entre 2 y 5 jugadores y entre 5, 10, 15 o 20 turnos.
- Cada turno empieza con una pregunta obligatoria. Solo si aciertas tiras el dado y resuelves la casilla.
- La ruleta y el tablero tienen los seis bloques del temario (legislativo, policial, tráfico, penal, ordenanzas y social, dos casillas cada uno). Mientras un bloque no tenga preguntas, sale una de otro. Hay además casillas de acción, sanción, regalo y túneles, y cartas de evento.
- Al pasar por Comisaría puedes optar al examen de ascenso (2, 3 o 4 preguntas según la categoría). Los multiplicadores de puntuación suben con cada categoría.
- Los efectivos a tu cargo se despliegan arrastrándolos desde el borde del tablero hasta la casilla que quieras.
- Gana quien más puntos tenga al final de los turnos.

## Estructura del proyecto

```
OpoQuiz092/
├── index.html              ← el juego (un solo archivo, se abre sin servidor)
├── README.md
├── CHANGELOG.md            ← qué cambió en cada versión
├── data/                   ← datos del juego, fuente de verdad
│   ├── preguntas/          ← un archivo por bloque del temario
│   │   ├── bloque-legislativo.json   (1307 preguntas)
│   │   ├── bloque-policial.json      (1253 preguntas)
│   │   └── …tráfico, penal, ordenanzas, social (pendientes)
│   ├── categorias.json     ← los 6 bloques de la ruleta: nombre, color, icono y orden
│   ├── cartas-evento.json
│   ├── casillas.json
│   └── escalafon.json
├── assets/                 ← vehiculos/, edificios/, avatar/, logo/, audio/
├── docs/
│   ├── reglas.md
│   ├── guia-preguntas.md   ← cómo escribir una pregunta
│   ├── fuentes.md          ← versión del BOE consultada y fecha
│   └── politica-privacidad.md
├── tools/                  ← validador de preguntas y build
├── tests/                  ← tests de datos y partidas simuladas
├── store/                  ← textos, capturas e icono para Play
└── .github/workflows/      ← validación automática
```

Los gráficos siguen incrustados en `index.html` como base64 y SVG (ver `assets/README.md`).

## Editar preguntas y datos

Los datos se editan en `data/`, nunca dentro de `index.html`. Después hay que copiarlos al juego (requiere Node.js 18 o superior):

```
node tools/validar.mjs           # revisa preguntas y datos, muestra la tabla por bloque y nivel
node tools/build.mjs             # copia data/ dentro de index.html
node --test tests/*.test.mjs     # tests
```

`build` reescribe solo el tramo entre las marcas `@DATOS` de `index.html`, así el juego sigue funcionando con doble clic. El formato de las preguntas está en [docs/guia-preguntas.md](docs/guia-preguntas.md).

## Estado y pendientes

- Versión actual: v14.2 (banco de preguntas del bloque legislativo, ver [CHANGELOG.md](CHANGELOG.md)).
- Avatar: imitación vectorial del estilo de referencia, no ilustración pintada.
- Los edificios del tablero conservan algunos restos de la peana en los bordes.
- Pruebas: se han jugado partidas simuladas completas en escritorio y móvil emulado. Falta probar en un móvil real el arrastre con el dedo y el zoom.
- Pendiente: el nombre definitivo de la academia y el dominio, para sustituir el sello provisional en `MARCA` (al principio del bloque de la pantalla de inicio).
- Pendiente: los bloques tráfico, penal, ordenanzas y social, y revisar las 23 preguntas marcadas `revisar` (15 del legislativo y 8 del policial).

## Marca

El nombre, el lema y el logotipo de la academia viven en la constante `MARCA` del código. Para cambiarlos, edita ese bloque. Los colores de marca están en las variables `--prop-*` del tema.

## Licencia

Uso privado. Todos los derechos reservados a PROPOLIS mientras no se indique lo contrario.
