-- Prueba del marcador, las monedas online y los logros online (3d, migración 20261128120000_marcador.sql).
-- Parte 3 de 5: sin límite diario (toda partida con premio contra el mismo rival da sus monedas).
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

-- d1 gana 20 partidas seguidas a d2 el mismo día. No hay límite diario: d2 (pierde) cobra sus 20 monedas
-- en todas y d1 (gana) sus 50, también la 6.ª, la 10.ª y la 20.ª.
set local role authenticated;
do $$ declare k int; begin
  for k in 1..20 loop
    perform set_config('test.g' || k, pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
  end loop;
end $$;
reset role;

-- ─────────────────────────────── 6. sin límite diario: toda partida con premio contra el mismo rival da sus monedas
do $$ declare k int; g uuid; begin
  for k in 1..20 loop
    g := current_setting('test.g' || k)::uuid;
    if pg_temp.mon_partida(g, 'd2') <> 20 then raise exception 'FALLO 6: la partida % no dio 20 monedas a quien pierde (%)', k, pg_temp.mon_partida(g, 'd2'); end if;
    if pg_temp.mon_partida(g, 'd1') <> 50 then raise exception 'FALLO 6: la partida % no dio 50 monedas a quien gana (%)', k, pg_temp.mon_partida(g, 'd1'); end if;
    if (pg_temp.premios(g) -> pg_temp.uid('d2')::text ->> 'monedas')::int <> 20 then raise exception 'FALLO 6: premios de la partida %', k; end if;
  end loop;
  if pg_temp.mon_partida(current_setting('test.g6')::uuid, 'd2') <> 20 or pg_temp.mon_partida(current_setting('test.g10')::uuid, 'd2') <> 20
     or pg_temp.mon_partida(current_setting('test.g20')::uuid, 'd2') <> 20 then raise exception 'FALLO 6: la 6.ª, la 10.ª o la 20.ª no dio 20 monedas'; end if;
  if (select count(*) || '/' || sum(delta) from public.coin_movements where user_id = pg_temp.uid('d2') and motivo = 'partida_online') <> '20/400'
     or (select count(*) || '/' || sum(delta) from public.coin_movements where user_id = pg_temp.uid('d1') and motivo = 'partida_online') <> '20/1000' then
    raise exception 'FALLO 6: movimientos de partida (20 por jugador: 400 y 1000 monedas)'; end if;
  perform pg_temp.ok('6 sin límite diario: 20 partidas el mismo día contra el mismo rival, todas con 20 monedas para quien pierde y 50 para quien gana (la 6.ª, la 10.ª y la 20.ª incluidas)');
end $$;

select replace(current_setting('test.informe'), ' | ', E'\n') as informe;
rollback;
