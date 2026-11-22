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

## Bloque penal (`data/preguntas/bloque-penal.json`)

Versión 1, generada el 21/11/2026. 1394 preguntas: 407 de exámenes de referencia (`origen: examen`) y 987 elaboradas a partir del temario (`origen: generada`). 6 están marcadas como `gemela` de otra.

| Tema | Contenido | Materia (`b`) | Normas principales |
|---|---|---|---|
| 20 | Poder Judicial y proceso penal: LOPJ, Tribunales de Instancia, competencia, LECrim, procedimientos, habeas corpus y medidas cautelares | PROC | CE, LO 6/1985 (LOPJ), LO 1/2025, LECrim, LO 5/1995, LO 6/1984, LO 5/2000, Ley 4/1985 |
| 21 | Código Penal (I): garantías, infracción penal, autoría, responsabilidad y circunstancias (arts. 1-31 quinquies) | CPGEN | LO 10/1995 (CP) |
| 22 | Código Penal (II): penas, aplicación, suspensión, medidas de seguridad, extinción y cancelación | PENAS | CP, LECrim |
| 23 | Código Penal (III): homicidio, lesiones, libertad, integridad moral y trata | PERSONAS | CP |
| 24 | Código Penal (IV): libertad sexual, hurto, robo, extorsión, uso de vehículos y usurpación | SEXPAT | CP, LO 10/2022 |
| 25 | Código Penal (V): salud pública (arts. 359-378) | DROGAS | CP |
| 26 | Código Penal (VI): seguridad vial (arts. 379-385 ter) | VIAL | CP |
| 27 | Código Penal (VII): Administración Pública y delitos con ocasión del ejercicio de derechos fundamentales | ADMIN | CP |
| 0 | Anexo PMM: derecho penal especial aplicado al servicio | PMM | CP |

| Norma | Publicación | Versión consolidada consultada | Fecha de revisión |
|---|---|---|---|
| LO 10/1995, del Código Penal | _pendiente_ | _pendiente_ | _pendiente_ |
| LO 6/1985, del Poder Judicial | _pendiente_ | _pendiente_ | _pendiente_ |
| LO 1/2025, de eficiencia del Servicio Público de Justicia | _pendiente_ | _pendiente_ | _pendiente_ |
| Ley de Enjuiciamiento Criminal | _pendiente_ | _pendiente_ | _pendiente_ |
| LO 5/1995, del Tribunal del Jurado | _pendiente_ | _pendiente_ | _pendiente_ |
| LO 6/1984, de habeas corpus | _pendiente_ | _pendiente_ | _pendiente_ |
| LO 5/2000, de responsabilidad penal de los menores | _pendiente_ | _pendiente_ | _pendiente_ |

20 preguntas llevan el campo `revisar` y no entran en el juego: todas son de la organización judicial reformada por la LO 1/2025, cuya implantación es escalonada (2025-2026). Hay que comprobarlas contra el texto vigente antes de cada convocatoria.

## Bloque tráfico (`data/preguntas/bloque-trafico.json`)

Temas 28 a 32: normas de circulación, competencias y requisitos de conductores y vehículos; señalización; denuncias y procedimiento; accidentes; alcoholemia y drogas.

| Norma | Publicación | Versión consolidada consultada | Fecha de revisión |
|---|---|---|---|
| RDLeg 6/2015, Ley de Tráfico y Seguridad Vial (LSV) | _pendiente_ | _pendiente_ | _pendiente_ |
| RD 1428/2003, Reglamento General de Circulación (RGCir) | _pendiente_ | _pendiente_ | _pendiente_ |
| RD 818/2009, Reglamento General de Conductores (RGCon) | _pendiente_ | _pendiente_ | _pendiente_ |
| RD 2822/1998, Reglamento General de Vehículos (RGV) | _pendiente_ | _pendiente_ | _pendiente_ |
| RD 320/1994, procedimiento sancionador de tráfico | _pendiente_ | _pendiente_ | _pendiente_ |
| RD 920/2017, inspección técnica de vehículos | _pendiente_ | _pendiente_ | _pendiente_ |
| Orden INT/2223/2014 y registro de víctimas (RNVAT) | _pendiente_ | _pendiente_ | _pendiente_ |

## Bloque ordenanzas (`data/preguntas/bloque-ordenanzas.json`)

Temas 13 a 19: Taxi, zonas verdes (Libro IV de la OPMAU), limpieza y salubridad, movilidad sostenible, contaminación acústica, venta ambulante y espectáculos (LEPAR).

| Norma | Publicación | Versión consolidada consultada | Fecha de revisión |
|---|---|---|---|
| Ordenanza del Taxi (28-11-2012), mod. Ordenanza 4/2025 | _pendiente_ | _pendiente_ | _pendiente_ |
| OPMAU (24-07-1985), Libro IV | _pendiente_ | _pendiente_ | _pendiente_ |
| Ordenanza 12/2022 de Limpieza y Ordenanza de Salubridad Pública | _pendiente_ | _pendiente_ | _pendiente_ |
| Ordenanza de Movilidad Sostenible (05-10-2018), mod. 10/2021 | _pendiente_ | _pendiente_ | _pendiente_ |
| Ordenanza de Contaminación Acústica y Térmica (25-02-2011) | _pendiente_ | _pendiente_ | _pendiente_ |
| Ordenanza de Venta Ambulante (27-03-2003) | _pendiente_ | _pendiente_ | _pendiente_ |
| Ley 17/1997 (LEPAR), Decreto 184/1998 y Orden de 21-04-2022 | _pendiente_ | _pendiente_ | _pendiente_ |

## Bloque social (`data/preguntas/bloque-social.json`)

Temas 35 a 40: extranjería, drogodependencias, violencia de género, igualdad, derechos LGTBI y prevención de riesgos laborales.

| Norma | Publicación | Versión consolidada consultada | Fecha de revisión |
|---|---|---|---|
| LO 4/2000 (LOEx), mod. RDL 2/2025 | BOE núm. 10, de 12/01/2000 | _pendiente_ | _pendiente_ |
| Ley 5/2002 de la Comunidad de Madrid | BOCM núm. 160, de 08/07/2002 | _pendiente_ | _pendiente_ |
| LO 1/2004 y Ley 27/2003 | BOE núm. 313, de 29/12/2004 | _pendiente_ | _pendiente_ |
| LO 3/2007 y III Plan de Igualdad del Ayuntamiento | BOE núm. 71, de 23/03/2007 | _pendiente_ | _pendiente_ |
| Ley 4/2023 | BOE núm. 51, de 01/03/2023 | _pendiente_ | _pendiente_ |
| Ley 31/1995 (LPRL) y Acuerdo-Convenio del Ayuntamiento 2019-2022 | BOE núm. 269, de 10/11/1995 | _pendiente_ | _pendiente_ |

## Cómo anotar una revisión

1. Abre la norma en el BOE y anota la fecha de la última actualización del texto consolidado.
2. Revisa las preguntas afectadas contra ese texto.
3. Rellena las columnas y añade una línea en `CHANGELOG.md`.
