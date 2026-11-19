# Reglas de Patrulla 092

## Preparación

- De 2 a 5 jugadores.
- Duración: 5, 10, 15 o 20 turnos por jugador.
- Todos empiezan en Comisaría con la categoría de Policía.

## Ronda

Al empezar cada ronda se saca una **carta de evento** (`data/cartas-evento.json`). Puede no tener efecto, cambiar el nivel de todas las preguntas de la ronda, abrir una convocatoria de ascenso o aplicar un efecto a uno o a todos los jugadores.

## Turno

1. **Pregunta obligatoria.** El nivel se sortea según tu categoría: cuanto más alta, más preguntas difíciles.
2. **Si aciertas**, tiras el dado y avanzas. Si fallas, el turno termina.
3. **Resuelves la casilla** donde caes.
4. **Despliegas efectivos**, si tienes en reserva, arrastrándolos desde el borde del tablero.

## Tablero

28 casillas (`data/casillas.json`):

| Tipo | Cantidad | Qué pasa |
|---|---|---|
| Temario (CE, EAM, LRBRL) | 13 | Pregunta del bloque de la casilla |
| Acción | 3 | Carta de acción: ventaja propia o ataque a un rival |
| Regalo | 2 | Ventaja para tu próximo turno o tarjeta para lanzar |
| Sanción | 4 | Penalización |
| Túnel y salida del túnel | 2 | Atajo por la M-30 |
| Esquinas | 4 | Comisaría (salida), El Retiro, Jefatura y Juzgado |

## Escalafón

Al pasar por Comisaría puedes presentarte al examen de ascenso si tienes los méritos necesarios (`data/escalafon.json`).

| Categoría | Multiplicador | Méritos | Grupo |
|---|---|---|---|
| Policía | ×1,0 | 0 | C1 |
| Oficial | ×1,1 | 3 | C1 |
| Subinspector | ×1,2 | 7 | A2 |
| Inspector | ×1,3 | 12 | A2 |
| Intendente | ×1,4 | 18 | A1 |
| Comisario | ×1,5 | 25 | A1 |
| Comisario Principal | ×1,6 | 33 | A1 |

El examen tiene 2, 3 o 4 preguntas según la categoría a la que aspiras.

## Racha y escudos

Encadenar aciertos da racha. Un escudo protege la racha de un fallo o de un ataque.

## Final

Gana quien tenga más puntos al acabar los turnos.
