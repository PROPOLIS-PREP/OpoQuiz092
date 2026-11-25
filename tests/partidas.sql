-- Prueba de la subfase 3a del cliente online (lobby de partidas) contra patrullan2-dev.
-- Reproduce lo que hace online/partidas.js: create_match('points', 2, turnos), join_match(código), leave_match,
-- y las lecturas de matches / match_players / friendships. La app no llama a start_match en esta subfase,
-- pero se prueba aquí para comprobar el abandono de una partida en curso.
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez.
-- Va dentro de una transacción que termina en ROLLBACK: no deja usuarios ni datos.
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe.
--
-- Usuarios: P1 (anfitrión), P2 (amigo de P1), P3 (desconocido) y P4 (sin partidas).

begin;
select set_config('test.informe', '', true);

-- ─────────────────────────────── preparación (como postgres)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa_uno@test.local',    now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa_dos@test.local',    now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa_tres@test.local',   now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa_cuatro@test.local', now(), '{}', now(), now());
insert into public.friendships (requester_id, addressee_id, status)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'accepted');

create function pg_temp.ok(p text) returns void language sql as
  $$ select set_config('test.informe', current_setting('test.informe') || 'OK ' || p || ' | ', true); $$;
-- partidas que cuentan para el límite de 3, como las cuenta la app (sala de espera de menos de 30 min o en curso)
create function pg_temp.activas() returns int language sql as $$
  select count(*)::int from public.matches
   where (status = 'lobby' and created_at > now() - interval '30 minutes') or status = 'in_progress' $$;
-- amigos del usuario actual, como los lee la app
create function pg_temp.es_amigo(p uuid) returns boolean language sql as $$
  select exists (select 1 from public.friendships where status = 'accepted' and p in (requester_id, addressee_id)) $$;

set local role authenticated;

-- ─────────────────────────────── 1. crear partida 1 contra 1 (P1, para su amigo P2)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$ declare r record; begin
  if not pg_temp.es_amigo('00000000-0000-0000-0000-0000000000b2') then raise exception 'FALLO: P2 no aparece como amigo de P1'; end if;
  if pg_temp.es_amigo('00000000-0000-0000-0000-0000000000b3') then raise exception 'FALLO: P3 aparece como amigo de P1'; end if;
  select * into r from public.create_match('points', 2, 10);
  if r.code !~ '^[A-HJKMNP-Z2-9]{5}$' then raise exception 'FALLO: código con formato inesperado: %', r.code; end if;
  perform set_config('test.mid', r.match_id::text, true);
  perform set_config('test.code', r.code, true);
  if (select count(*) from public.matches where id = r.match_id and status = 'lobby' and max_players = 2 and turns = 10 and mode = 'points') <> 1 then
    raise exception 'FALLO: la partida no queda en sala de espera con 2 jugadores, 10 turnos y modo points';
  end if;
  if (select count(*) from public.match_players where match_id = r.match_id) <> 1 then raise exception 'FALLO: el anfitrión no está en la sala'; end if;
  perform pg_temp.ok('crear partida 1 contra 1 (points, 2, 10) con código de 5 letras');
end $$;

-- ─────────────────────────────── 2. unirse con código (en minúsculas y con espacios, como lo puede escribir el usuario)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
do $$ declare v uuid; begin
  v := public.join_match(' ' || lower(current_setting('test.code')) || ' ');
  if v <> current_setting('test.mid')::uuid then raise exception 'FALLO: join_match devuelve otra partida'; end if;
  if public.join_match(current_setting('test.code')) <> v then raise exception 'FALLO: volver a unirse no devuelve la misma partida'; end if;
  if (select count(*) from public.match_players where match_id = v) <> 2 then raise exception 'FALLO: P2 no ve a los 2 jugadores'; end if;
  perform pg_temp.ok('unirse con código; repetir no duplica');
end $$;

-- ─────────────────────────────── 3. sala completa, código inexistente, y cada uno solo ve sus partidas
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.matches) <> 0 or (select count(*) from public.match_players) <> 0 then
    raise exception 'FALLO: P3 ve partidas ajenas';
  end if;
  begin perform public.join_match(current_setting('test.code')); raise exception 'FALLO: P3 entra en una sala completa';
  exception when raise_exception then if sqlerrm not like 'La partida está completa%' then raise; end if; end;
  begin perform public.join_match('ZZZZZ'); raise exception 'FALLO: se entra con un código inexistente';
  exception when raise_exception then if sqlerrm not like 'No existe ninguna partida%' then raise; end if; end;
  perform pg_temp.ok('sala completa y código inexistente rechazados; P3 no ve partidas ajenas');
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.matches) <> 0 then raise exception 'FALLO: P4 ve partidas ajenas'; end if;
  perform pg_temp.ok('P4 no ve ninguna partida');
end $$;

-- ─────────────────────────────── 4. «Empezar» solo el anfitrión (la app no lo usa aún; se prueba el backend)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
do $$ begin
  begin perform public.start_match(current_setting('test.mid')::uuid); raise exception 'FALLO: un invitado puede empezar';
  exception when raise_exception then if sqlerrm not like 'Solo el anfitrión%' then raise; end if; end;
  perform pg_temp.ok('solo el anfitrión puede empezar');
end $$;

-- ─────────────────────────────── 5. límite de 3 (lo controla la app; el backend no lo impide)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$ begin
  perform public.create_match('points', 2, 5);
  perform public.create_match('points', 2, 15);
  if pg_temp.activas() <> 3 then raise exception 'FALLO: la app contaría % partidas, no 3', pg_temp.activas(); end if;
  -- el backend deja crear una cuarta: por eso el límite es solo de la app (pendiente en docs/backend-v2.md)
  perform public.create_match('points', 2, 10);
  if pg_temp.activas() <> 4 then raise exception 'FALLO: cambio de comportamiento: el backend ya limita las partidas (actualizar docs y app)'; end if;
  perform pg_temp.ok('la cuenta de la app da 3; el backend no impide la cuarta (pendiente de backend)');
end $$;

-- ─────────────────────────────── 6. salas de más de 30 minutos: dejan de contar y se cierran saliendo
reset role;
update public.matches set created_at = now() - interval '31 minutes'
 where host_id = '00000000-0000-0000-0000-0000000000b1' and id <> current_setting('test.mid')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$ declare m record; begin
  if pg_temp.activas() <> 1 then raise exception 'FALLO: las salas caducadas siguen contando'; end if;
  for m in select id from public.matches where status = 'lobby' and created_at <= now() - interval '30 minutes' loop
    perform public.leave_match(m.id);   -- lo que hace la app al abrir la lista
  end loop;
  if (select count(*) from public.matches) <> 1 then raise exception 'FALLO: las salas caducadas no se cierran al salir'; end if;
  perform pg_temp.ok('salas caducadas: no cuentan y se borran al salir el único jugador');
end $$;

-- ─────────────────────────────── 7. salir de la sala: el anfitrión pasa al otro; si no queda nadie, se borra
do $$ begin
  perform public.leave_match(current_setting('test.mid')::uuid);
  if (select count(*) from public.matches) <> 0 then raise exception 'FALLO: P1 sigue viendo la sala tras salir'; end if;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
do $$ begin
  if (select host_id from public.matches where id = current_setting('test.mid')::uuid) <> '00000000-0000-0000-0000-0000000000b2' then
    raise exception 'FALLO: el anfitrión no pasa a P2';
  end if;
  perform public.leave_match(current_setting('test.mid')::uuid);
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.matches where id = current_setting('test.mid')::uuid) then raise exception 'FALLO: la sala vacía no se borra'; end if;
  perform pg_temp.ok('salir: el anfitrión pasa al otro y la sala vacía se borra');
end $$;

-- ─────────────────────────────── 8. abandonar una partida en curso: pierde quien sale
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$ declare r record; begin
  select * into r from public.create_match('points', 2, 10);
  perform set_config('test.mid', r.match_id::text, true); perform set_config('test.code', r.code, true);
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select public.join_match(current_setting('test.code'));
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select public.start_match(current_setting('test.mid')::uuid);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
do $$ begin
  if (select status from public.matches where id = current_setting('test.mid')::uuid) <> 'in_progress' then raise exception 'FALLO: la partida no está en curso'; end if;
  perform public.leave_match(current_setting('test.mid')::uuid);
  if (select status || '/' || finish_reason || '/' || winner_id from public.matches where id = current_setting('test.mid')::uuid)
     <> 'finished/forfeit/00000000-0000-0000-0000-0000000000b1' then
    raise exception 'FALLO: abandonar en curso no da la victoria al rival';
  end if;
  if pg_temp.activas() <> 0 then raise exception 'FALLO: una partida terminada sigue contando para el límite'; end if;
  perform pg_temp.ok('abandonar en curso: gana el rival y deja de contar');
end $$;

-- ─────────────────────────────── 9. sin sesión no hay nada
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin perform 1 from public.matches; raise exception 'FALLO: anon lee matches';
  exception when insufficient_privilege then null; end;
  begin perform public.create_match('points', 2, 10); raise exception 'FALLO: anon crea partidas';
  exception when insufficient_privilege then null; end;
  perform pg_temp.ok('anon no lee ni crea partidas');
end $$;
reset role;
do $$ begin
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('matches', 'match_players')) <> 2 then
    raise exception 'FALLO: matches o match_players no están en Realtime';
  end if;
  perform pg_temp.ok('matches y match_players publicadas en Realtime');
end $$;

select current_setting('test.informe') || 'TODOS LOS TESTS OK' as informe;
rollback;
