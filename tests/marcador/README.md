# Pruebas del marcador (3d)

Prueban `supabase/migrations/20261128120000_marcador.sql`: puntos, monedas online y logros online.

## Cómo se ejecutan

En el SQL Editor de Supabase (rol postgres), cada archivo por separado y entero:

1. Si la migración **no** está aplicada, pega su contenido en la línea marcada («↓↓↓ pega aquí la migración ↓↓↓»), justo después de `begin;`.
   Si ya está aplicada, no pegues nada.
2. Ejecuta. Cada archivo termina en `rollback;`: no deja usuarios, tablas ni datos.
3. Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe con una línea `OK` por bloque.

Cada parte es independiente (los jugadores empiezan a 0). El orden recomendado:

| Orden | Archivo | Qué prueba | Informe esperado |
|---|---|---|---|
| 1 | `1_victoria_empate_disputed.sql` | victoria, derrota con suelo de 0, empate, disputed | `OK 1`, `OK 2`, `OK 3` |
| 2 | `2_abandono_cobro_unico.sql` | abandono (−5, o 0 si ya tenía 0; 0 monedas), cobro único | `OK 4`, `OK 5` |
| 3 | `3_monedas_sin_limite.sql` | sin límite diario: 20 partidas el mismo día contra el mismo rival, todas con sus monedas (20 quien pierde, 50 quien gana) | `OK 6` |
| 4 | `4_logros.sql` | Bronce leído de `game_config.ligas` (movido a 150), 5 seguidas, 10 victorias, saldos = suma de movimientos | `OK 7a`, `OK 7b`, `OK 8` |
| 5 | `5_rls.sql` | el cliente solo lee: RLS y permisos | `OK 9` |
