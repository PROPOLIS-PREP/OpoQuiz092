# Recursos gráficos y de audio

Hoy todos los gráficos (logo, vehículos, edificios) están **incrustados en `index.html`** como imágenes base64 y SVG, y los sonidos son tonos generados por código. Estas carpetas están preparadas para los archivos originales:

| Carpeta | Contenido |
|---|---|
| `vehiculos/` | Fichas de vehículos |
| `edificios/` | Ilustraciones de las casillas del tablero |
| `avatar/` | Piezas del avatar |
| `logo/` | Logotipo e identidad de PROPOLIS |
| `audio/` | Efectos de sonido y música |

Las 14 fichas de vehículos incluyen su propia peana. Sus PNG están incrustados en `FIG_VEH` dentro de `index.html` y se usan en el tablero y las vistas previas.

Los nueve edificios del mapa central usan los PNG incrustados en `EDIF_IMG` dentro de `index.html`.

## Avatar

El avatar es **una sola imagen** que el juego compone a partir de capas PNG: fondo, marco, agente, accesorio y gorra, más la peana debajo en la taquilla y la portada. Cada combinación se dibuja una vez y se guarda en memoria.

| Carpeta | Piezas | Hueco en el juego |
|---|---|---|
| `avatar/agentes/` | agente_m, agente_f (ya llevan su gorra de plato o su boina) | Agente |
| `avatar/fondos/` | retiro, granvia, alcala, atardecer (Debod), cibeles, kio (Cuatro Torres) | Fondo |
| `avatar/gorras/` | plato, boina, lana, casco_bici, casco_moto, intervencion | Gorra |
| `avatar/extras/` | bigote, pinganillo, silbato, radio, bufanda (braga), gafas | Accesorio |
| `avatar/marcos/` | basico (azul con bandera), bronce, plata, platino, marco_damero, laureles | Placa |
| `avatar/peanas/` | b_clasica (asfalto), b_damero, b_adoquin, b_cesped, b_neon, b_oro | Peana |

El nombre del archivo es el identificador de la pieza en el código (`ACC` en `index.html`).

**Para añadir o cambiar una pieza:**

1. Guarda el PNG (384 × 384, fondo transparente) en su carpeta.
2. Si es gorra o accesorio, añade su posición en `data/avatar.json` para cada agente: `[x, y, ancho]` en el espacio del dibujo del agente (384 px), o `null` si no se pinta.
3. Ejecuta `py tools/avatar.py --muestra hoja.png` (necesita Pillow). Optimiza las imágenes a `avatar/web/*.webp` y dibuja una hoja de prueba para comprobar las posiciones.
4. Añade la pieza al catálogo `ACC` de `index.html` (nombre y precio) y ejecuta `node tools/build.mjs`.

Los tests comprueban que cada pieza del catálogo tiene imagen.

En el código, busca `ARTE:` para ver dónde se engancha cada gráfico y `SONIDOS` para el audio.
