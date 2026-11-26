-- Prueba del marcador, las monedas online y los logros online (3d, migración 20261128120000_marcador.sql).
-- Parte 1 de 5: victoria y derrota (suelo de 0), empate y disputed.
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

set local role authenticated;

-- ─────────────────────────────── 1. victoria y derrota (y suelo de 0)
select set_config('test.m1', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
reset role;
do $$ declare p jsonb := pg_temp.premios(current_setting('test.m1')::uuid); m uuid := current_setting('test.m1')::uuid; begin
  if pg_temp.puntos('d1') <> 30 or pg_temp.puntos('d2') <> 0 then raise exception 'FALLO 1: puntos % %', pg_temp.puntos('d1'), pg_temp.puntos('d2'); end if;
  if pg_temp.delta(m, 'd2') <> 0 or (select resultado from public.score_changes where match_id = m and user_id = pg_temp.uid('d2')) <> 'loss' then
    raise exception 'FALLO 1: el perdedor con 0 puntos no se queda en 0 (delta real 0)'; end if;
  if pg_temp.mon_partida(m, 'd1') <> 50 or pg_temp.mon_partida(m, 'd2') <> 20 then raise exception 'FALLO 1: monedas de la partida'; end if;
  if pg_temp.logros('d1') <> 'online_primera_victoria' or pg_temp.monedas('d1') <> 70 or pg_temp.monedas('d2') <> 20 then
    raise exception 'FALLO 1: logro o saldo: % % %', pg_temp.logros('d1'), pg_temp.monedas('d1'), pg_temp.monedas('d2'); end if;
  if p -> pg_temp.uid('d1')::text <> '{"resultado":"win","puntos":30,"total":30,"monedas":50,"logros":[{"id":"online_primera_victoria","nombre":"Primera victoria online","monedas":20}]}'::jsonb
     or p -> pg_temp.uid('d2')::text <> '{"resultado":"loss","puntos":0,"total":0,"monedas":20,"logros":[]}'::jsonb then
    raise exception 'FALLO 1: premios en la jugada fin: %', p; end if;
  perform pg_temp.ok('1 victoria +30 y 50 monedas (+20 del logro «Primera victoria online»); derrota −5 con suelo de 0 y 20 monedas; «fin» lleva los premios');
end $$;
set local role authenticated;

-- ─────────────────────────────── 2. empate: +30 para los dos y 20 monedas, sin extras
select set_config('test.m2', pg_temp.jugar('d1', 'd2', 500, 500)::text, true);
reset role;
do $$ declare m uuid := current_setting('test.m2')::uuid; begin
  if (select winner_id from public.matches where id = m) is not null then raise exception 'FALLO 2: el empate tiene ganador'; end if;
  if pg_temp.puntos('d1') <> 60 or pg_temp.puntos('d2') <> 30 then raise exception 'FALLO 2: puntos % %', pg_temp.puntos('d1'), pg_temp.puntos('d2'); end if;
  if pg_temp.mon_partida(m, 'd1') <> 20 or pg_temp.mon_partida(m, 'd2') <> 20 then raise exception 'FALLO 2: monedas'; end if;
  if (select count(*) from public.score_changes where match_id = m and resultado = 'draw') <> 2 then raise exception 'FALLO 2: resultado draw'; end if;
  if (select valor from public.user_progress where user_id = pg_temp.uid('d1') and metrica = 'racha_online') <> 0 then raise exception 'FALLO 2: el empate no corta la racha'; end if;
  if pg_temp.logros('d2') <> '' then raise exception 'FALLO 2: d2 (30 puntos) tiene logros: %', pg_temp.logros('d2'); end if;
  -- Bronce empieza en 50: d1 llega a 60 con el empate y consigue «Llegar a Bronce» (+20 monedas)
  if pg_temp.logro_en('d1', 'online_bronce') is distinct from m or pg_temp.monedas('d1') <> 110
     or not (pg_temp.premios(m) -> pg_temp.uid('d1')::text -> 'logros') @> '[{"id":"online_bronce"}]' then
    raise exception 'FALLO 2: Bronce con 60 puntos (tramo de 50): % · % monedas', pg_temp.logro_en('d1', 'online_bronce'), pg_temp.monedas('d1'); end if;
  perform pg_temp.ok('2 empate: +30 para los dos, 20 monedas cada uno, sin ganador; corta la racha; d1 llega a 60 y consigue Bronce (tramo de 50, +20 monedas)');
end $$;
set local role authenticated;

-- ─────────────────────────────── 3. disputed: no cambia nada
select set_config('test.m3', pg_temp.jugar('d1', 'd2', 700, 300, 310)::text, true);
reset role;
do $$ declare m uuid := current_setting('test.m3')::uuid; begin
  if (select finish_reason from public.matches where id = m) <> 'disputed' then raise exception 'FALLO 3: no es disputed'; end if;
  if exists (select 1 from public.score_changes where match_id = m) or exists (select 1 from public.coin_movements where match_id = m)
     or pg_temp.puntos('d1') <> 60 or pg_temp.puntos('d2') <> 30 or pg_temp.monedas('d1') <> 110 or pg_temp.monedas('d2') <> 40 then
    raise exception 'FALLO 3: disputed cambió algo'; end if;
  if pg_temp.premios(m) <> '{}'::jsonb then raise exception 'FALLO 3: premios %', pg_temp.premios(m); end if;
  if (select valor from public.user_progress where user_id = pg_temp.uid('d1') and metrica = 'partidas_online') <> 2 then raise exception 'FALLO 3: disputed cuenta como partida'; end if;
  perform pg_temp.ok('3 disputed: sin puntos, sin monedas, sin progreso y «fin» con premios vacíos');
end $$;

select replace(current_setting('test.informe'), ' | ', E'\n') as informe;
rollback;
