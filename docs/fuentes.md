# Fuentes legales

Versión de cada norma usada para redactar y revisar las preguntas. Actualiza la fila cuando revises una norma contra el BOE.

## Bloque legislativo (`data/preguntas/bloque-legislativo.json`)

Versión 1, generada el 19/11/2026. 1307 preguntas: 100 de dos tests de referencia (`origen: test1` y `test2`) y 1207 elaboradas a partir del temario (`origen: generada`).

| Tema | Contenido | Categoría en el juego | Normas principales |
|---|---|---|---|
| 1 | CE (I): estructura, principios y reforma | CE | Constitución Española |
| 2 | CE (II): derechos y deberes, amparo, Defensor del Pueblo, suspensión, TC | CE | CE, LO 3/1981, LO 4/1981, LO 2/1979 |
| 3 | CE (III): Corona, Cortes, Gobierno, organización territorial | CE | CE, LOREG |
| 4 | Derecho, Derecho Administrativo y reglamentos | LRBRL | CE, LRBRL |
| 5 | Estatuto de Autonomía de la Comunidad de Madrid | EAM | LO 3/1983 |
| 6 | Administración Local | LRBRL | Ley 7/1985, LOREG, TRRL |
| 7 | ROGA del Ayuntamiento de Madrid | LRBRL | ROGA (31/05/2004), Decreto de Áreas de 17/06/2023 |

| Norma | Publicación | Versión consolidada consultada | Fecha de revisión |
|---|---|---|---|
| Constitución Española | BOE núm. 311, de 29/12/1978 | _pendiente_ | _pendiente_ |
| LO 3/1983, Estatuto de Autonomía de la Comunidad de Madrid | BOE núm. 51, de 01/03/1983 | _pendiente_ | _pendiente_ |
| Ley 7/1985, reguladora de las Bases del Régimen Local | BOE núm. 80, de 03/04/1985 | _pendiente_ | _pendiente_ |
| LO 5/1985, del Régimen Electoral General | _pendiente_ | _pendiente_ | _pendiente_ |
| ROGA del Ayuntamiento de Madrid | _pendiente_ | _pendiente_ | _pendiente_ |

### Preguntas pendientes de revisar

15 preguntas llevan el campo `revisar` y **no entran en el juego**: dos respuestas defendibles, una opción incompleta, una clave dudosa o datos que pueden haber cambiado (composición del Senado, organigrama municipal, titulares de cargos). Para verlas: `node tools/validar.mjs`.

## Cómo anotar una revisión

1. Abre la norma en el BOE y anota la fecha de la última actualización del texto consolidado.
2. Revisa las preguntas afectadas contra ese texto.
3. Rellena las columnas y añade una línea en `CHANGELOG.md`.
