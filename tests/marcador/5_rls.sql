-- Prueba del marcador, las monedas online y los logros online (3d, migración 20261128120000_marcador.sql).
-- Parte 5 de 5: el cliente solo lee (RLS y permisos).
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
select set_config('test.m1', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);

-- ─────────────────────────────── 9. el cliente solo lee (RLS y permisos)
do $$ declare m1 uuid := current_setting('test.m1')::uuid; begin
  perform pg_temp.como('d3');
  if exists (select 1 from public.wallets where user_id <> pg_temp.uid('d3')) or exists (select 1 from public.coin_movements where user_id <> pg_temp.uid('d3'))
     or exists (select 1 from public.user_progress where user_id <> pg_temp.uid('d3')) or exists (select 1 from public.user_achievements where user_id <> pg_temp.uid('d3')) then
    raise exception 'FALLO 9: d3 lee monedas, progreso o logros ajenos'; end if;
  if exists (select 1 from public.score_changes where match_id = m1) then raise exception 'FALLO 9: d3 lee los puntos de una partida ajena'; end if;
  if (select count(*) from public.scores where user_id in (pg_temp.uid('d1'), pg_temp.uid('d2'))) <> 2
     or (select count(*) from public.game_config) < 3 or (select count(*) from public.achievements) < 4 then
    raise exception 'FALLO 9: d3 no lee la clasificación, la configuración o los logros'; end if;
  perform pg_temp.como('d1');
  if (select count(*) from public.wallets) <> 1 or (select count(*) from public.user_achievements) <> 1 then raise exception 'FALLO 9: d1 no ve lo suyo'; end if;
  perform pg_temp.como('d2');
  if (select count(*) from public.score_changes where match_id = m1) <> 2 then raise exception 'FALLO 9: d2 no ve los puntos de su partida'; end if;
  begin update public.wallets set monedas = 9999 where user_id = pg_temp.uid('d2'); raise exception 'FALLO 9: el cliente cambió su saldo';
  exception when insufficient_privilege then null; end;
  begin insert into public.coin_movements (user_id, delta, motivo) values (pg_temp.uid('d2'), 100, 'ajuste'); raise exception 'FALLO 9: el cliente se dio monedas';
  exception when insufficient_privilege then null; end;
  begin update public.scores set puntos = 999 where user_id = pg_temp.uid('d2'); raise exception 'FALLO 9: el cliente cambió sus puntos';
  exception when insufficient_privilege then null; end;
  begin insert into public.user_achievements (user_id, achievement_id) values (pg_temp.uid('d2'), 'online_10_victorias'); raise exception 'FALLO 9: el cliente se dio un logro';
  exception when insufficient_privilege then null; end;
  begin update public.user_progress set valor = 99 where user_id = pg_temp.uid('d2'); raise exception 'FALLO 9: el cliente cambió su progreso';
  exception when insufficient_privilege then null; end;
  begin update public.game_config set valor = '{}' where clave = 'puntos_1v1'; raise exception 'FALLO 9: el cliente cambió la configuración';
  exception when insufficient_privilege then null; end;
  begin perform private.apply_match_rewards(m1, pg_temp.uid('d2'), 'completed'); raise exception 'FALLO 9: el cliente llamó al reparto';
  exception when insufficient_privilege then null; end;
  begin perform private.finish_match(m1, pg_temp.uid('d2'), 'completed'); raise exception 'FALLO 9: el cliente llamó a finish_match';
  exception when insufficient_privilege then null; end;
  perform pg_temp.ok('9 RLS: saldo, movimientos, progreso y logros solo los ve su dueño; clasificación, configuración y logros para todos; el cliente no escribe ni reparte');
end $$;
reset role;

select replace(current_setting('test.informe'), ' | ', E'\n') as informe;
rollback;
