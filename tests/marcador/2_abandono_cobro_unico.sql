-- Prueba del marcador, las monedas online y los logros online (3d, migración 20261128120000_marcador.sql).
-- Parte 2 de 5: abandono y cobro único.
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
select set_config('test.m1', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);   -- d1 gana: d1 30, d2 0
select set_config('test.m2', pg_temp.abandona('d1', 'd2')::text, true);          -- d2 (con 0 puntos) abandona
select set_config('test.m3', pg_temp.jugar('d2', 'd1', 900, 400)::text, true);   -- d2 gana: d2 30, d1 55
select set_config('test.m4', pg_temp.abandona('d1', 'd2')::text, true);          -- d2 (con 30 puntos) abandona
reset role;

-- ─────────────────────────────── 4. abandono = derrota (−5, con el suelo de 0) y 0 monedas; el rival gana
do $$ declare m2 uuid := current_setting('test.m2')::uuid; m4 uuid := current_setting('test.m4')::uuid; begin
  if (select finish_reason || '/' || winner_id from public.matches where id = m2) <> 'forfeit/' || pg_temp.uid('d1')
     or (select finish_reason || '/' || winner_id from public.matches where id = m4) <> 'forfeit/' || pg_temp.uid('d1') then
    raise exception 'FALLO 4: no son forfeit con ganador d1'; end if;
  if pg_temp.delta(m2, 'd2') <> 0 or pg_temp.delta(m2, 'd1') <> 30 then raise exception 'FALLO 4: abandono con 0 puntos: % %', pg_temp.delta(m2, 'd2'), pg_temp.delta(m2, 'd1'); end if;
  if pg_temp.delta(m4, 'd2') <> -5 or pg_temp.delta(m4, 'd1') <> 30 then raise exception 'FALLO 4: abandono con 30 puntos: % %', pg_temp.delta(m4, 'd2'), pg_temp.delta(m4, 'd1'); end if;
  if (select resultado from public.score_changes where match_id = m4 and user_id = pg_temp.uid('d2')) <> 'loss' then raise exception 'FALLO 4: el abandono no es derrota'; end if;
  if pg_temp.mon_partida(m2, 'd2') <> 0 or pg_temp.mon_partida(m4, 'd2') <> 0 or pg_temp.mon_partida(m2, 'd1') <> 50 or pg_temp.mon_partida(m4, 'd1') <> 50 then
    raise exception 'FALLO 4: monedas del abandono'; end if;
  if (pg_temp.premios(m4) -> pg_temp.uid('d2')::text ->> 'monedas')::int <> 0 or (pg_temp.premios(m4) -> pg_temp.uid('d2')::text ->> 'puntos')::int <> -5 then
    raise exception 'FALLO 4: premios del abandono: %', pg_temp.premios(m4); end if;
  -- saldos: d1 = 50 + 20 (logro) + 50 + 20 (derrota en m3) + 50; d2 = 20 + 0 + 50 + 20 (logro) + 0
  if pg_temp.puntos('d1') <> 85 or pg_temp.puntos('d2') <> 25 or pg_temp.monedas('d1') <> 190 or pg_temp.monedas('d2') <> 90 then
    raise exception 'FALLO 4: saldos: puntos % % monedas % %', pg_temp.puntos('d1'), pg_temp.puntos('d2'), pg_temp.monedas('d1'), pg_temp.monedas('d2'); end if;
  perform pg_temp.ok('4 abandono: quien abandona −5 (0 si ya tenía 0) y 0 monedas; el rival +30 y 50 monedas');
end $$;

-- ─────────────────────────────── 5. cobro único
do $$ declare antes jsonb; m1 uuid := current_setting('test.m1')::uuid; begin
  antes := (select jsonb_build_object('p1', pg_temp.puntos('d1'), 'p2', pg_temp.puntos('d2'), 'm1', pg_temp.monedas('d1'), 'm2', pg_temp.monedas('d2'),
            'mov', (select count(*) from public.coin_movements), 'sc', (select count(*) from public.score_changes),
            'lg', (select count(*) from public.user_achievements), 'pr', (select sum(valor) from public.user_progress)));
  if private.apply_match_rewards(m1, pg_temp.uid('d1'), 'completed') <> '{}'::jsonb then raise exception 'FALLO 5: repartió dos veces'; end if;
  perform private.finish_match(m1, pg_temp.uid('d1'), 'completed');
  if antes <> (select jsonb_build_object('p1', pg_temp.puntos('d1'), 'p2', pg_temp.puntos('d2'), 'm1', pg_temp.monedas('d1'), 'm2', pg_temp.monedas('d2'),
            'mov', (select count(*) from public.coin_movements), 'sc', (select count(*) from public.score_changes),
            'lg', (select count(*) from public.user_achievements), 'pr', (select sum(valor) from public.user_progress))) then
    raise exception 'FALLO 5: algo cambió al repetir'; end if;
  begin
    insert into public.coin_movements (user_id, delta, motivo, match_id) values (pg_temp.uid('d1'), 50, 'partida_online', m1);
    raise exception 'FALLO 5: se cobró dos veces la misma partida';
  exception when unique_violation then null; end;
  begin
    insert into public.score_changes (match_id, user_id, antes, despues, delta, resultado) values (m1, pg_temp.uid('d1'), 0, 30, 30, 'win');
    raise exception 'FALLO 5: la misma partida puntuó dos veces';
  exception when unique_violation then null; end;
  begin
    insert into public.coin_movements (user_id, delta, motivo, item_id) values (pg_temp.uid('d1'), 20, 'logro', 'online_primera_victoria');
    raise exception 'FALLO 5: se cobró dos veces el mismo logro';
  exception when unique_violation then null; end;
  perform pg_temp.ok('5 cobro único: repetir el reparto o finish_match no cambia nada; los índices únicos lo impiden también a mano (partida, puntos y logro)');
end $$;

select replace(current_setting('test.informe'), ' | ', E'\n') as informe;
rollback;
