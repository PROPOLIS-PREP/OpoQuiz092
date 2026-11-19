# Patrulla 092

Juego de preguntas y tablero para opositores a Policía Municipal de Madrid, en la línea de Preguntados y Monopoly. Cada jugador contesta test del temario, tira el dado y avanza por un plano de Madrid para ganar puntos, ascender en el escalafón y reclutar efectivos.

Es un prototipo jugable de las mecánicas. Las preguntas son provisionales y los rivales, la liga y los amigos están simulados.

## Cómo se abre

Todo el juego está en un único archivo: `patrulla-092-v14.html` (en el repositorio, `index.html`).

1. Descarga el archivo.
2. Ábrelo con cualquier navegador moderno (Chrome, Edge, Safari, Firefox).
3. Para jugar desde el móvil, súbelo a cualquier alojamiento estático (por ejemplo, GitHub Pages) y abre el enlace.

No hace falta instalar nada ni tener conexión, salvo para cargar la tipografía de Google Fonts. El progreso se guarda en el propio navegador (localStorage), así que cada dispositivo tiene su perfil.

## Cómo se juega

- Eliges entre 2 y 5 jugadores y entre 5, 10, 15 o 20 turnos.
- Cada turno empieza con una pregunta obligatoria. Solo si aciertas tiras el dado y resuelves la casilla.
- Hay casillas de preguntas por bloque legislativo, casillas de acción, sanción, regalo y túneles, y cartas de evento.
- Al pasar por Comisaría puedes optar al examen de ascenso (2, 3 o 4 preguntas según la categoría). Los multiplicadores de puntuación suben con cada categoría.
- Los efectivos a tu cargo se despliegan arrastrándolos desde el borde del tablero hasta la casilla que quieras.
- Gana quien más puntos tenga al final de los turnos.

## Estructura del proyecto

- `patrulla-092-v14.html`: juego completo (HTML, CSS y JavaScript en un solo archivo, sin dependencias).
- `README.md`: este documento.

Los gráficos (logo, vehículos, edificios y avatar) están incrustados en el propio archivo como imágenes en base64 y SVG.

## Estado y pendientes

- Versión actual: v14. Incluye la identidad de PROPOLIS en la pantalla de inicio.
- Avatar: imitación vectorial del estilo de referencia, no ilustración pintada.
- Los edificios del tablero conservan algunos restos de la peana en los bordes.
- Pruebas: se han jugado partidas simuladas completas en escritorio y móvil emulado. Falta probar en un móvil real el arrastre con el dedo y el zoom.
- Pendiente: el nombre definitivo de la academia y el dominio, para sustituir el sello provisional en `MARCA` (al principio del bloque de la pantalla de inicio).
- Pendiente: sustituir las preguntas de prueba por la base de datos real del temario.

## Marca

El nombre, el lema y el logotipo de la academia viven en la constante `MARCA` del código. Para cambiarlos, edita ese bloque. Los colores de marca están en las variables `--prop-*` del tema.

## Licencia

Uso privado. Todos los derechos reservados a PROPOLIS mientras no se indique lo contrario.
