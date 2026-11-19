# Cómo escribir y añadir preguntas

Las preguntas viven en `data/preguntas/`, **un archivo por bloque del temario**:

| Archivo | Estado |
|---|---|
| `bloque-legislativo.json` | Cargado (1307 preguntas, temas 1 a 7) |
| `bloque-policial.json` | Pendiente |
| `bloque-trafico.json` | Pendiente |
| `bloque-penal.json` | Pendiente |
| `bloque-ordenanzas.json` | Pendiente |
| `bloque-social.json` | Pendiente |

El juego no lee estos archivos directamente: después de editarlos hay que copiarlos dentro de `index.html`.

```
node tools/validar.mjs     # revisa las preguntas y muestra la tabla por categoría y nivel
node tools/build.mjs       # copia data/ dentro de index.html
```

Hace falta Node.js 18 o superior. Si hay errores, `build` no toca `index.html`. Las subcarpetas de `data/preguntas/` no se cargan.

## Bloque y categoría

- **Bloque**: la parte del temario de la que sale el archivo (legislativo, policial, tráfico…). Es el campo `bloque` del archivo.
- **Categoría**: lo que ve el jugador en el tablero, la ruleta y la cabecera de la pregunta (Constitución, Estatuto CM, Régimen local). Es el campo `b` de cada pregunta y debe existir en `data/categorias.json`.

Un bloque puede repartir sus preguntas en varias categorías. El legislativo usa tres: `CE` (temas 1 a 3), `EAM` (tema 5) y `LRBRL` (temas 4, 6 y 7).

## Formato del archivo

```json
{
  "bloque": "legislativo",
  "version": 1,
  "temas": { "1": "CE (I): estructura, principios y reforma" },
  "total": 1307,
  "preguntas": [
    {
      "id": "LEG-T1-001",
      "tema": 1,
      "b": "CE",
      "n": 1,
      "q": "¿Cuál es la forma política del Estado español?",
      "o": ["La Monarquía parlamentaria", "La República federal", "La Monarquía absoluta", "La República parlamentaria"],
      "a": 0,
      "d": "Art. 1.3 CE: la forma política del Estado español es la Monarquía parlamentaria.",
      "fuente": "CE art. 1.3",
      "origen": "generada"
    }
  ]
}
```

| Campo | Obligatorio | Qué es |
|---|---|---|
| `id` | Recomendado | Identificador único en todos los archivos (`LEG-T1-001`). El validador da error si se repite. |
| `b` | Sí | Categoría del juego. Si todas las preguntas del archivo son de la misma, puede ponerse una vez arriba como `"categoria"`. |
| `n` | Sí | Nivel de 1 a 7 (1 = Policía … 7 = Comisario Principal). Cuanto más alta la categoría del jugador, más niveles altos le salen. |
| `q` | Sí | Enunciado. |
| `o` | Sí | 3 o 4 opciones, sin repetir. |
| `a` | Sí | Posición de la correcta, **empezando en 0** (0 = primera). |
| `d` | Recomendado | Explicación que aparece tras responder. |
| `tema`, `fuente`, `origen`, `bloque` | No | Informativos. No llegan al juego. |
| `revisar` | No | Motivo por el que la pregunta tiene un problema. **Mientras tenga este campo no entra en el juego.** Al corregirla, borra el campo. |

## Añadir un bloque nuevo

1. Guarda el archivo como `data/preguntas/bloque-<nombre>.json` con el formato de arriba.
2. Si sus preguntas usan categorías nuevas (por ejemplo `TRAF`), añádelas a `data/categorias.json` con `clave`, `nombre` y `color`. El orden de esa lista es el orden de la ruleta.
3. Ejecuta `node tools/validar.mjs` y después `node tools/build.mjs`.
4. Una categoría nueva sale enseguida en la ruleta y en las preguntas de turno. Para que tenga casillas propias, cambia el `t` de alguna casilla de temario en `data/casillas.json` a la clave nueva.

## Criterios de calidad

- Una sola respuesta correcta según la letra de la norma. Si hay dos defendibles, marca la pregunta con `revisar`.
- Distractores verosímiles: plazos cercanos, órganos parecidos, artículos vecinos.
- Evita "todas las anteriores" y "ninguna de las anteriores".
- Reparte la posición de la correcta.
- Datos que cambian (composición de órganos, organigramas, titulares de cargos): compruébalos antes de cada convocatoria.
