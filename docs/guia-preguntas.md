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

## Bloque y materia

- **Bloque**: la parte del temario de la que sale el archivo. Es lo que ve el jugador en la ruleta, en las casillas del tablero y en la cabecera de la pregunta. Es el campo `bloque` del archivo y debe ser una de las claves de `data/categorias.json`: `legislativo`, `policial`, `trafico`, `penal`, `ordenanzas` o `social`.
- **Materia**: el campo `b` de cada pregunta. Es informativo y no llega al juego. El legislativo usa tres: `CE` (temas 1 a 3), `EAM` (tema 5) y `LRBRL` (temas 4, 6 y 7).

Los seis bloques ya están en la ruleta y tienen dos casillas cada uno. Mientras un bloque no tenga preguntas, la ruleta lo avisa y sale una pregunta de otro bloque.

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
| `bloque` (del archivo) | Sí | Bloque del temario: decide el sector de la ruleta y las casillas. Una pregunta suelta puede llevar su propio `bloque`, que manda sobre el del archivo. Si el archivo es una lista sin cabecera, el bloque sale del nombre (`bloque-trafico.json` → `trafico`). |
| `b` | No | Materia dentro del bloque (CE, EAM, LRBRL…). Informativa. |
| `n` | Sí | Nivel de 1 a 7 (1 = Policía … 7 = Comisario Principal). Cuanto más alta la categoría del jugador, más niveles altos le salen. |
| `q` | Sí | Enunciado. |
| `o` | Sí | 3 o 4 opciones, sin repetir. |
| `a` | Sí | Posición de la correcta, **empezando en 0** (0 = primera). |
| `d` | Recomendado | Explicación que aparece tras responder. |
| `gemela` | No | `id` de otra pregunta que pregunta lo mismo con otras palabras (por ejemplo, la misma pregunta en dos tests). En una partida solo sale una de cada grupo de gemelas, y el validador no avisa de que repitan enunciado. Las preguntas con enunciado idéntico también se tratan como gemelas en la partida. |
| `tema`, `fuente`, `origen` | No | Informativos. No llegan al juego. |
| `revisar` | No | Motivo por el que la pregunta tiene un problema. **Mientras tenga este campo no entra en el juego.** Al corregirla, borra el campo. |

## Añadir un bloque nuevo

1. Guarda el archivo como `data/preguntas/bloque-<clave>.json` con `"bloque": "<clave>"` (por ejemplo `bloque-trafico.json` con `"bloque": "trafico"`).
2. Ejecuta `node tools/validar.mjs` y después `node tools/build.mjs`.
3. No hace falta tocar nada más: el bloque ya tiene su sector en la ruleta y sus dos casillas, y desde ese momento sus preguntas sustituyen a las de relleno. También aparece solo su objetivo diario ("Acierta 3 de …").

Nombre, color, icono y orden de la ruleta de cada bloque están en `data/categorias.json`; las casillas, en el campo `t` de `data/casillas.json`.

## Criterios de calidad

- Una sola respuesta correcta según la letra de la norma. Si hay dos defendibles, marca la pregunta con `revisar`.
- Distractores verosímiles: plazos cercanos, órganos parecidos, artículos vecinos.
- Evita "todas las anteriores" y "ninguna de las anteriores".
- Reparte la posición de la correcta.
- Datos que cambian (composición de órganos, organigramas, titulares de cargos): compruébalos antes de cada convocatoria.
