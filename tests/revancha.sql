-- Prueba de la revancha (request_rematch, migración 20261127120000_revancha.sql) contra patrullan2-dev.
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez, con la migración aplicada.
-- Antes de aplicarla se puede probar igual poniendo el contenido de la migración justo después de «begin;».
-- Va dentro de una transacción que termina en ROLLBACK: no deja usuarios ni datos.
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe.
-- Dentro de una transacción now() no avanza: la caducidad se simula atrasando pedida_at como postgres.
--
-- Usuarios: R1 (anfitrión, asiento 0), R2 (rival, asiento 1) y R3 (intruso).

begin;
select set_config('test.informe', '', true);
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rv_uno@test.local',  now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rv_dos@test.local',  now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rv_tres@test.local', now(), '{}', now(), now());
create function pg_temp.ok(p text) returns void language sql as
  $$ select set_config('test.informe', current_setting('test.informe') || 'OK ' || p || ' | ', true); $$;
create function pg_temp.como(u text) returns void language sql as
  $$ select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000' || u || '","role":"authenticated"}', true); $$;
-- partida de R1 (anfitrión) contra R2, empezada; devuelve su id
create function pg_temp.partida() returns uuid language plpgsql as $$
declare r record; begin
  perform pg_temp.como('f1'); select * into r from public.create_match('points', 2, 5);
  perform pg_temp.como('f2'); perform public.join_match(r.code);
  perform pg_temp.como('f1'); perform public.start_match(r.match_id);
  return r.match_id;
end $$;
-- ¿lanza esa llamada un error con ese texto?
create function pg_temp.falla(sql text, texto text) returns boolean language plpgsql as $$
begin execute sql; return false;
exception when others then if sqlerrm like texto || '%' then return true; end if; raise; end $$;
create function pg_temp.revanchas(p uuid) returns integer language sql as
  $$ select count(*)::integer from public.matches where rematch_of = p $$;

-- perfiles antes (la revancha no da puntos, monedas ni logros)
select set_config('test.perfiles', (select jsonb_agg(to_jsonb(p) order by p.id)::text from public.profiles p
  where p.id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')), true);

set local role authenticated;
select set_config('test.m1', pg_temp.partida()::text, true);

-- ─────────────────────────────── 1. partida sin terminar, intruso y sin sesión
do $$ begin
  perform pg_temp.como('f1');
  if not pg_temp.falla(format('select * from public.request_rematch(%L)', current_setting('test.m1')), 'La partida aún no ha terminado') then
    raise exception 'FALLO: se pidió la revancha de una partida en curso'; end if;
  perform pg_temp.ok('partida no terminada: rechazada («La partida aún no ha terminado»)');
end $$;
reset role;
update public.matches set status = 'finished', finished_at = now(), finish_reason = 'completed',
  winner_id = '00000000-0000-0000-0000-0000000000f1' where id = current_setting('test.m1')::uuid;
set local role authenticated;
do $$ begin
  perform pg_temp.como('f3');
  if not pg_temp.falla(format('select * from public.request_rematch(%L)', current_setting('test.m1')), 'No jugaste esa partida') then
    raise exception 'FALLO: un intruso pidió la revancha'; end if;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if not pg_temp.falla(format('select * from public.request_rematch(%L)', current_setting('test.m1')), 'Necesitas iniciar sesión') then
    raise exception 'FALLO: sin sesión se pidió la revancha'; end if;
  if pg_temp.revanchas(current_setting('test.m1')::uuid) <> 0 then raise exception 'FALLO: se creó una partida'; end if;
  perform pg_temp.ok('tercero o intruso: rechazado («No jugaste esa partida»); sin sesión: rechazado');
end $$;

-- ─────────────────────────────── 2. una petición sola: espera
do $$ declare r record; begin
  perform pg_temp.como('f1');
  select * into r from public.request_rematch(current_setting('test.m1')::uuid);
  if r.estado <> 'esperando' or r.match_id is not null or r.segundos <> 120 then raise exception 'FALLO: una petición sola: %', to_jsonb(r); end if;
  if pg_temp.revanchas(current_setting('test.m1')::uuid) <> 0 then raise exception 'FALLO: con una sola petición se creó una partida'; end if;
  if (select count(*) from public.match_rematch_requests where match_id = current_setting('test.m1')::uuid) <> 1 then raise exception 'FALLO: no se anotó la petición'; end if;
  perform pg_temp.ok('una petición sola: «esperando», 120 s, sin partida nueva');
  -- R3 no ve las peticiones de una partida ajena
  perform pg_temp.como('f3');
  if (select count(*) from public.match_rematch_requests) <> 0 then raise exception 'FALLO: el intruso ve peticiones ajenas'; end if;
  perform pg_temp.como('f2');
  if (select count(*) from public.match_rematch_requests where match_id = current_setting('test.m1')::uuid) <> 1 then raise exception 'FALLO: el rival no ve la petición'; end if;
  begin insert into public.match_rematch_requests (match_id, user_id) values (current_setting('test.m1')::uuid, '00000000-0000-0000-0000-0000000000f2');
    raise exception 'FALLO: se insertó una petición sin pasar por request_rematch';
  exception when insufficient_privilege then null; end;
  perform pg_temp.ok('las peticiones solo las ven los jugadores de la partida y solo se crean con request_rematch');
end $$;

-- ─────────────────────────────── 3. petición caducada: no crea nada
reset role;
update public.match_rematch_requests set pedida_at = now() - interval '121 seconds'
 where match_id = current_setting('test.m1')::uuid and user_id = '00000000-0000-0000-0000-0000000000f1';
set local role authenticated;
do $$ declare r record; begin
  perform pg_temp.como('f2');
  select * into r from public.request_rematch(current_setting('test.m1')::uuid);
  if r.estado <> 'esperando' or pg_temp.revanchas(current_setting('test.m1')::uuid) <> 0 then
    raise exception 'FALLO: con la petición del rival caducada: %', to_jsonb(r); end if;
  perform pg_temp.ok('petición del rival caducada (121 s): no crea nada y la nueva queda «esperando»');
end $$;

-- ─────────────────────────────── 4. dos peticiones dentro de 2 minutos: partida nueva con los dos, ya en curso
do $$ declare r record; m public.matches; a record; begin
  perform pg_temp.como('f1');
  select * into r from public.request_rematch(current_setting('test.m1')::uuid);
  if r.estado <> 'creada' or r.match_id is null or r.code !~ '^[A-HJKMNP-Z2-9]{5}$' then raise exception 'FALLO: dos peticiones: %', to_jsonb(r); end if;
  perform set_config('test.m2', r.match_id::text, true);
  select * into m from public.matches where id = r.match_id;
  if m.rematch_of <> current_setting('test.m1')::uuid or m.status <> 'in_progress' or m.seed is null or m.started_at is null
     or m.host_id <> '00000000-0000-0000-0000-0000000000f1' or m.mode <> 'points' or m.turns <> 5 or m.max_players <> 2 then
    raise exception 'FALLO: la partida nueva: %', to_jsonb(m); end if;
  if (select jsonb_agg(jsonb_build_array(user_id, seat) order by seat) from public.match_players where match_id = r.match_id)
     <> '[["00000000-0000-0000-0000-0000000000f1",0],["00000000-0000-0000-0000-0000000000f2",1]]'::jsonb then
    raise exception 'FALLO: jugadores o asientos de la revancha'; end if;
  select * into a from public.match_actions where match_id = r.match_id and seq = 0;
  if a.kind <> 'inicio' or (a.payload->>'seed')::bigint <> m.seed or (a.payload->>'turns')::int <> 5
     or a.payload->'players' <> '["00000000-0000-0000-0000-0000000000f1","00000000-0000-0000-0000-0000000000f2"]'::jsonb then
    raise exception 'FALLO: jugada inicio de la revancha: %', a.payload; end if;
  if exists (select 1 from public.match_rematch_requests where match_id = current_setting('test.m1')::uuid) then
    raise exception 'FALLO: quedaron peticiones tras crear la revancha'; end if;
  perform pg_temp.ok('dos peticiones en 2 minutos: partida nueva en curso con los dos, mismos asientos, anfitrión, modo y turnos, semilla e «inicio»');
  -- los dos la ven (RLS) y la pueden jugar
  perform pg_temp.como('f2');
  if not exists (select 1 from public.matches where rematch_of = current_setting('test.m1')::uuid) then raise exception 'FALLO: el rival no ve la revancha'; end if;
  perform public.heartbeat(r.match_id);
  perform pg_temp.como('f3');
  if exists (select 1 from public.matches where id = r.match_id) then raise exception 'FALLO: el intruso ve la revancha'; end if;
  perform pg_temp.ok('los dos ven la revancha (el intruso no) y pueden jugarla');
end $$;

-- ─────────────────────────────── 5. nunca dos revanchas de la misma partida
do $$ declare r record; begin
  perform pg_temp.como('f2');
  select * into r from public.request_rematch(current_setting('test.m1')::uuid);
  if r.estado <> 'creada' or r.match_id <> current_setting('test.m2')::uuid then raise exception 'FALLO: segunda llamada: %', to_jsonb(r); end if;
  perform pg_temp.como('f1');
  select * into r from public.request_rematch(current_setting('test.m1')::uuid);
  if r.match_id <> current_setting('test.m2')::uuid or pg_temp.revanchas(current_setting('test.m1')::uuid) <> 1 then
    raise exception 'FALLO: se creó otra revancha'; end if;
  perform pg_temp.ok('pedirla otra vez (cualquiera de los dos) devuelve la misma partida: 1 revancha');
end $$;
reset role;
do $$ begin
  begin
    insert into public.matches (code, host_id, mode, max_players, turns, rematch_of)
    values ('ZZZZ9', '00000000-0000-0000-0000-0000000000f1', 'points', 2, 5, current_setting('test.m1')::uuid);
    raise exception 'FALLO: se guardaron dos revanchas de la misma partida';
  exception when unique_violation then null; end;
  perform pg_temp.ok('a la vez: la fila de la partida anterior se bloquea (for update) y el índice único impide una segunda revancha');
end $$;
set local role authenticated;

-- ─────────────────────────────── 6. máximo de 3 partidas activas (y partida terminada por abandono)
select set_config('test.m3', pg_temp.partida()::text, true);
reset role;
update public.matches set status = 'finished', finished_at = now(), finish_reason = 'forfeit',
  winner_id = '00000000-0000-0000-0000-0000000000f2' where id = current_setting('test.m3')::uuid;
set local role authenticated;
-- R2 pide la revancha con 1 partida activa (la revancha de antes) y luego abre 2 salas: llega a 3
do $$ declare r record; begin
  perform pg_temp.como('f2');
  select * into r from public.request_rematch(current_setting('test.m3')::uuid);
  if r.estado <> 'esperando' then raise exception 'FALLO: revancha de una partida terminada por abandono: %', to_jsonb(r); end if;
  perform public.create_match('points', 2, 5); perform public.create_match('points', 2, 5);
  perform pg_temp.como('f1');
  if not pg_temp.falla(format('select * from public.request_rematch(%L)', current_setting('test.m3')), 'Tu rival ya tiene 3 partidas a la vez') then
    raise exception 'FALLO: se creó la revancha con el rival en el máximo'; end if;
  if pg_temp.revanchas(current_setting('test.m3')::uuid) <> 0 then raise exception 'FALLO: se creó una partida con el rival en el máximo'; end if;
  perform pg_temp.como('f2');
  if not pg_temp.falla(format('select * from public.request_rematch(%L)', current_setting('test.m3')), 'Ya tienes 3 partidas a la vez') then
    raise exception 'FALLO: pidió la revancha quien ya tiene 3 partidas'; end if;
  perform pg_temp.ok('máximo de 3: rechazada si el rival lo tiene («Tu rival ya tiene 3 partidas a la vez») o si lo tiene quien la pide («Ya tienes 3 partidas a la vez»), sin crear nada');
end $$;
-- una sala de espera de más de 30 minutos no cuenta: con ella caducada, la revancha sí se crea
reset role;
update public.matches set created_at = now() - interval '31 minutes'
 where id = (select m.id from public.matches m join public.match_players mp on mp.match_id = m.id
              where mp.user_id = '00000000-0000-0000-0000-0000000000f2' and m.status = 'lobby' limit 1);
set local role authenticated;
do $$ declare r record; begin
  perform pg_temp.como('f2'); perform public.request_rematch(current_setting('test.m3')::uuid);
  perform pg_temp.como('f1');
  select * into r from public.request_rematch(current_setting('test.m3')::uuid);
  if r.estado <> 'creada' then raise exception 'FALLO: con una sala caducada no se creó la revancha: %', to_jsonb(r); end if;
  perform pg_temp.ok('una sala de espera de más de 30 minutos no cuenta para el máximo; partida terminada por abandono: revancha creada');
end $$;

-- ─────────────────────────────── 7. sin puntos, monedas ni logros
reset role;
do $$ begin
  if (select jsonb_agg(to_jsonb(p) order by p.id)::text from public.profiles p
       where p.id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')) <> current_setting('test.perfiles') then
    raise exception 'FALLO: la revancha cambió el perfil'; end if;
  perform pg_temp.ok('los perfiles no cambian (sin puntos, monedas ni logros)');
end $$;

select replace(current_setting('test.informe'), ' | ', E'\n') as informe;
rollback;
