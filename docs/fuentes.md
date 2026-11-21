# Fuentes legales

Versión de cada norma usada para redactar y revisar las preguntas. Actualiza la fila cuando revises una norma contra el BOE.

## Bloque legislativo (`data/preguntas/bloque-legislativo.json`)

Versión 1, generada el 19/11/2026. 1307 preguntas: 100 de dos tests de referencia (`origen: test1` y `test2`) y 1207 elaboradas a partir del temario (`origen: generada`).

| Tema | Contenido | Materia (`b`) | Normas principales |
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

La cuarta reforma de la Constitución modificó el artículo 69.3 y se publicó en el BOE de 20/05/2026 ([BOE-A-2026-10881](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-10881)). Se han actualizado las preguntas sobre el número y el procedimiento de las reformas y la representación de Ibiza y Formentera.

### Preguntas pendientes de revisar

15 preguntas llevan el campo `revisar` y **no entran en el juego**: dos respuestas defendibles, una opción incompleta, una clave dudosa o datos que pueden haber cambiado (composición del Senado, organigrama municipal, titulares de cargos). Para verlas: `node tools/validar.mjs`.

## Bloque policial (`data/preguntas/bloque-policial.json`)

Versión 1, generada el 20/11/2026. 1253 preguntas: 100 de dos tests de referencia (`origen: test1` y `test2`) y 1153 elaboradas a partir del temario y de las tarjetas de estudio (`origen: generada`). 26 están marcadas como `gemela` de otra (la misma pregunta en los dos tests).

| Tema | Contenido | Materia (`b`) | Normas principales |
|---|---|---|---|
| 8 | Reglamento del Cuerpo de Policía Municipal de Madrid: funcionamiento y saludo | RPMM | Reglamento PMM (31/03/1995), Título III |
| 9 | Régimen disciplinario del CNP | DISC | LO 4/2010 |
| 10 | Coordinación de Policías Locales de la CM: disposiciones generales y principios básicos | LCPL | Ley 1/2018, LOFCS |
| 11 | Reglamento Marco (I): ordenación, estructura, promoción interna y movilidad | RMARCO | Decreto 210/2021, Ley 1/2018 |
| 12 | Reglamento Marco (II): formación, régimen disciplinario y uniformidad | RMARCO | Decreto 210/2021, Decreto 49/2023 |
| 33 | Modelo policial español, policías autonómicas y locales, Juntas Locales de Seguridad | LOFCS | LO 2/1986, RD 1087/2010, Ley 17/2015, PLATERCAM, PEMAM |
| 34 | Protección de la seguridad ciudadana | LOPSC | LO 4/2015 |

| Norma | Publicación | Versión consolidada consultada | Fecha de revisión |
|---|---|---|---|
| LO 2/1986, de Fuerzas y Cuerpos de Seguridad | _pendiente_ | _pendiente_ | _pendiente_ |
| LO 4/2010, régimen disciplinario del CNP | _pendiente_ | _pendiente_ | _pendiente_ |
| LO 4/2015, de protección de la seguridad ciudadana | _pendiente_ | _pendiente_ | _pendiente_ |
| Ley 1/2018, de Coordinación de Policías Locales de la CM | _pendiente_ | _pendiente_ | _pendiente_ |
| Decreto 210/2021, Reglamento Marco de las Policías Locales de la CM | _pendiente_ | _pendiente_ | _pendiente_ |
| Decreto 49/2023, uniformidad, equipo y medios móviles | _pendiente_ | _pendiente_ | _pendiente_ |
| Reglamento del Cuerpo de Policía Municipal de Madrid (1995) | _pendiente_ | _pendiente_ | _pendiente_ |
| RD 1087/2010, Reglamento de Juntas Locales de Seguridad | _pendiente_ | _pendiente_ | _pendiente_ |

8 preguntas llevan el campo `revisar` y no entran en el juego: tres con una clave discutible y cinco con datos que pueden cambiar (policías autonómicas, unidades adscritas, dependencia de las FCSE, uso de imágenes de agentes).

## Cómo anotar una revisión

1. Abre la norma en el BOE y anota la fecha de la última actualización del texto consolidado.
2. Revisa las preguntas afectadas contra ese texto.
3. Rellena las columnas y añade una línea en `CHANGELOG.md`.
