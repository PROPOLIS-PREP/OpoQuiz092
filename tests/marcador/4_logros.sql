-- Prueba del marcador, las monedas online y los logros online (3d, migración 20261128120000_marcador.sql).
-- Parte 4 de 5: logros (Bronce leído de game_config.ligas, 5 seguidas, 10 victorias) y saldos.
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez.
-- Si la migración 20261128120000_marcador.sql aún no está aplicada, pega su contenido en la línea marcada,
-- justo después de «begin;». Con la migración aplicada, no pegues nada.
-- Termina en ROLLBACK: no deja usuarios, tablas ni datos. Cada parte es independiente (los jugadores empiezan a 0).
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe.
-- Dentro de una transacción now() no avanza: todas las partidas son «del mismo día».
-- Usuarios: M1, M2 (rivales habituales) y M3 (otro rival e intruso).

begin;
-- ↓↓↓ pega aquí la migración 20261128120000_marcador.sql (si aún no está aplicada) ↓↓↓

-- ↑↑↑ fin de la migración ↑↑↑

select set_config('test.informe', '', true);
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mc_uno@test.local',  now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mc_dos@test.local',  now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mc_tres@test.local', now(), '{}', now(), now());
create function pg_temp.ok(p text) returns void language sql as
  $$ select set_config('test.informe', current_setting('test.informe') || 'OK ' || p || ' | ', true); $$;
create function pg_temp.como(u text) returns void language sql as
  $$ select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000' || u || '","role":"authenticated"}', true); $$;
create function pg_temp.uid(u text) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000' || u)::uuid $$;
-- partida empezada entre a (anfitrión) y b
create function pg_temp.partida(a text, b text) returns uuid language plpgsql as $$
declare r record; begin
  perform pg_temp.como(a); select * into r from public.create_match('points', 2, 5);
  perform pg_temp.como(b); perform public.join_match(r.code);
  perform pg_temp.como(a); perform public.start_match(r.match_id);
  return r.match_id;
end $$;
-- partida terminada con los puntos del motor (pa para a, pb para b); con pb2, b informa otra cosa (disputed)
create function pg_temp.jugar(a text, b text, pa int, pb int, pb2 int default null) returns uuid language plpgsql as $$
declare m uuid := pg_temp.partida(a, b);
        s jsonb := jsonb_build_object(pg_temp.uid(a)::text, pa, pg_temp.uid(b)::text, pb);
begin
  perform pg_temp.como(a); perform public.report_result(m, s);
  perform pg_temp.como(b);
  perform public.report_result(m, case when pb2 is null then s else jsonb_build_object(pg_temp.uid(a)::text, pa, pg_temp.uid(b)::text, pb2) end);
  return m;
end $$;
-- b abandona una partida contra a (leave_match): gana a
create function pg_temp.abandona(a text, b text) returns uuid language plpgsql as $$
declare m uuid := pg_temp.partida(a, b); begin
  perform pg_temp.como(b); perform public.leave_match(m); return m;
end $$;
create function pg_temp.puntos(u text) returns int language sql as $$ select coalesce((select puntos from public.scores where user_id = pg_temp.uid(u)), 0) $$;
create function pg_temp.monedas(u text) returns int language sql as $$ select coalesce((select monedas from public.wallets where user_id = pg_temp.uid(u)), 0) $$;
create function pg_temp.premios(m uuid) returns jsonb language sql as
  $$ select payload -> 'premios' from public.match_actions where match_id = m and kind = 'fin' $$;
create function pg_temp.mon_partida(m uuid, u text) returns int language sql as
  $$ select coalesce(sum(delta), 0)::int from public.coin_movements where match_id = m and user_id = pg_temp.uid(u) and motivo = 'partida_online' $$;
create function pg_temp.delta(m uuid, u text) returns int language sql as
  $$ select delta from public.score_changes where match_id = m and user_id = pg_temp.uid(u) $$;
create function pg_temp.logros(u text) returns text language sql as
  $$ select coalesce(string_agg(achievement_id, ',' order by achievement_id), '') from public.user_achievements where user_id = pg_temp.uid(u) $$;
create function pg_temp.logro_en(u text, l text) returns uuid language sql as
  $$ select match_id from public.user_achievements where user_id = pg_temp.uid(u) and achievement_id = l $$;

-- El tramo «Bronce» se mueve de 50 a 70 puntos en game_config.ligas: el logro debe seguirlo (no hay un umbral fijo).
update public.game_config
   set valor = '[{"nombre": "Sin liga", "desde": 0}, {"nombre": "Bronce", "desde": 70}, {"nombre": "Plata", "desde": 100}, {"nombre": "Oro", "desde": 200}]'
 where clave = 'ligas';

-- d1 contra d2: w1 gana (30), w2 empata (60, corta la racha), w3–w7 gana (90, 120, 150, 180, 210; racha de 5 en w7)
-- d1 contra d3: w8–w11 gana (victorias 7, 8, 9, 10), w12 gana (11: ningún logro nuevo)
set local role authenticated;
select set_config('test.w1', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
select set_config('test.w2', pg_temp.jugar('d1', 'd2', 500, 500)::text, true);
select set_config('test.w3', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
select set_config('test.w4', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
select set_config('test.w5', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
select set_config('test.w6', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
select set_config('test.w7', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
reset role;

-- ─────────────────────────────── 7a. Bronce sigue al tramo de game_config y la racha de 5 empieza tras el empate
do $$ begin
  if pg_temp.puntos('d1') <> 210 then raise exception 'FALLO 7a: puntos de d1 %', pg_temp.puntos('d1'); end if;
  if pg_temp.logro_en('d1', 'online_bronce') is distinct from current_setting('test.w3')::uuid then
    raise exception 'FALLO 7a: Bronce (tramo movido a 70) no llega con 90 puntos (w3) sino en %', pg_temp.logro_en('d1', 'online_bronce'); end if;
  if pg_temp.logro_en('d1', 'online_racha_5') is distinct from current_setting('test.w7')::uuid then raise exception 'FALLO 7a: racha de 5'; end if;
  if pg_temp.logro_en('d1', 'online_primera_victoria') is distinct from current_setting('test.w1')::uuid then raise exception 'FALLO 7a: primera victoria'; end if;
  if not (pg_temp.premios(current_setting('test.w3')::uuid) -> pg_temp.uid('d1')::text -> 'logros') @> '[{"id":"online_bronce"}]'
     or jsonb_array_length(pg_temp.premios(current_setting('test.w2')::uuid) -> pg_temp.uid('d1')::text -> 'logros') <> 0 then
    raise exception 'FALLO 7a: premios de w2 o w3'; end if;
  perform pg_temp.ok('7a Bronce con el tramo de game_config (movido a 70: llega en w3 con 90 y no en w2 con 60, que con el tramo de 50 ya bastaría); 5 seguidas tras el empate; primera victoria');
end $$;

set local role authenticated;
select pg_temp.jugar('d1', 'd3', 900, 400); select pg_temp.jugar('d1', 'd3', 900, 400); select pg_temp.jugar('d1', 'd3', 900, 400);
select set_config('test.w11', pg_temp.jugar('d1', 'd3', 900, 400)::text, true);   -- 10.ª victoria
select pg_temp.jugar('d1', 'd3', 900, 400);                                        -- 11.ª: ningún logro nuevo
reset role;

-- ─────────────────────────────── 7b. 10 victorias; cada logro una sola vez y con 20 monedas
do $$ begin
  if pg_temp.logros('d1') <> 'online_10_victorias,online_bronce,online_primera_victoria,online_racha_5' then raise exception 'FALLO 7b: logros de d1: %', pg_temp.logros('d1'); end if;
  if pg_temp.logro_en('d1', 'online_10_victorias') is distinct from current_setting('test.w11')::uuid then raise exception 'FALLO 7b: 10 victorias'; end if;
  if (select count(*) from public.coin_movements where user_id = pg_temp.uid('d1') and motivo = 'logro') <> 4
     or (select sum(delta) from public.coin_movements where user_id = pg_temp.uid('d1') and motivo = 'logro') <> 80 then raise exception 'FALLO 7b: monedas de logros'; end if;
  if pg_temp.logros('d2') <> '' or pg_temp.logros('d3') <> '' then raise exception 'FALLO 7b: logros sin victorias: % / %', pg_temp.logros('d2'), pg_temp.logros('d3'); end if;
  perform pg_temp.ok('7b 10 victorias en la 10.ª; cada logro una sola vez y con 20 monedas; sin victorias, sin logros');
end $$;

-- ─────────────────────────────── 8. el saldo es la suma de los movimientos
do $$ begin
  if exists (select 1 from public.wallets w where w.user_id in (pg_temp.uid('d1'), pg_temp.uid('d2'), pg_temp.uid('d3'))
              and w.monedas <> (select sum(delta) from public.coin_movements c where c.user_id = w.user_id)) then
    raise exception 'FALLO 8: wallets.monedas no coincide con coin_movements'; end if;
  if exists (select 1 from public.scores s where s.user_id in (pg_temp.uid('d1'), pg_temp.uid('d2'), pg_temp.uid('d3'))
              and s.puntos <> (select sum(delta) from public.score_changes c where c.user_id = s.user_id)) then
    raise exception 'FALLO 8: scores.puntos no coincide con score_changes'; end if;
  perform pg_temp.ok('8 wallets = suma de coin_movements y scores = suma de score_changes');
end $$;

select replace(current_setting('test.informe'), ' | ', E'\n') as informe;
rollback;
