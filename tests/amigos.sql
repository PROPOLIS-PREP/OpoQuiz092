-- Prueba de la fase 2 del cliente online (amigos) contra patrullan2-dev.
-- Reproduce lo que hace online/amigos.js: búsqueda exacta en profiles (ILIKE con el _ escapado),
-- lectura de friendships y las RPC send_friend_request, respond_friend_request, remove_friend y block_user.
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez.
-- Va dentro de una transacción que termina en ROLLBACK: no deja usuarios ni datos.
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe.
--
-- Usuarios: A (am_ana), B (am_berto) y C (am_carla).

begin;
select set_config('test.informe', '', true);

-- ─────────────────────────────── preparación (como postgres)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'am_ana@test.local',   now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'am_berto@test.local', now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'am_carla@test.local', now(), '{}', now(), now());
update public.profiles set username = 'am_ana'   where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set username = 'am_berto' where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set username = 'am_carla' where id = '00000000-0000-0000-0000-0000000000a3';

-- cuántas filas de friendships ve el usuario actual, por estado
create function pg_temp.veo(p_status text) returns int language sql as
  $$ select count(*)::int from public.friendships where status = p_status $$;
create function pg_temp.ok(p text) returns void language sql as
  $$ select set_config('test.informe', current_setting('test.informe') || 'OK ' || p || ' | ', true); $$;

set local role authenticated;

-- ─────────────────────────────── 1. búsqueda exacta (como el cliente: ILIKE con \_)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.profiles where username ilike 'AM\_BERTO') <> 1 then raise exception 'FALLO: la búsqueda exacta no encuentra a am_berto'; end if;
  if (select count(*) from public.profiles where username ilike 'am\_bert') <> 0 then raise exception 'FALLO: la búsqueda encuentra por parte del nombre'; end if;
  if (select count(*) from public.profiles where username ilike 'amXberto') <> 0 then raise exception 'FALLO: el _ actúa como comodín'; end if;
  perform pg_temp.ok('búsqueda solo por nombre exacto, sin distinguir mayúsculas');
end $$;

-- ─────────────────────────────── 2. enviar y cancelar (Enviadas → cancelar)
do $$ declare v bigint; begin
  v := public.send_friend_request('am_berto');
  if pg_temp.veo('pending') <> 1 then raise exception 'FALLO: A no ve su solicitud enviada'; end if;
  perform public.remove_friend(v);
  if pg_temp.veo('pending') <> 0 then raise exception 'FALLO: cancelar no borra la solicitud'; end if;
  perform pg_temp.ok('enviar y cancelar');
end $$;

-- ─────────────────────────────── 3. enviar y rechazar (Recibidas → rechazar)
select set_config('test.fid', public.send_friend_request('am_berto')::text, true);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.friendships where status = 'pending' and addressee_id = auth.uid()) <> 1 then
    raise exception 'FALLO: B no ve la solicitud recibida';
  end if;
  perform public.respond_friend_request(current_setting('test.fid')::bigint, false);
  if pg_temp.veo('pending') <> 0 then raise exception 'FALLO: rechazar no borra la solicitud'; end if;
  perform pg_temp.ok('recibir y rechazar');
end $$;

-- ─────────────────────────────── 4. enviar y aceptar (Recibidas → aceptar); C no ve nada
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('test.fid', public.send_friend_request('am_berto')::text, true);
do $$ begin
  begin perform public.send_friend_request('am_berto'); raise exception 'FALLO: segunda solicitud aceptada';
  exception when raise_exception then if sqlerrm not like 'Ya le enviaste%' then raise; end if; end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select public.respond_friend_request(current_setting('test.fid')::bigint, true);
do $$ begin
  if pg_temp.veo('accepted') <> 1 then raise exception 'FALLO: B no ve la amistad'; end if;
  begin perform public.send_friend_request('am_ana'); raise exception 'FALLO: solicitud entre amigos aceptada';
  exception when raise_exception then if sqlerrm not like 'Ya sois amigos%' then raise; end if; end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.friendships) <> 0 then raise exception 'FALLO: C ve amistades ajenas'; end if;
  begin perform public.remove_friend(current_setting('test.fid')::bigint); raise exception 'FALLO: C borra una amistad ajena';
  exception when raise_exception then if sqlerrm not like 'No existe esa relación%' then raise; end if; end;
  perform pg_temp.ok('recibir y aceptar; un tercero no ve ni borra');
end $$;

-- ─────────────────────────────── 5. eliminar amigo (Amigos → eliminar)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.remove_friend(current_setting('test.fid')::bigint);
  if pg_temp.veo('accepted') <> 0 then raise exception 'FALLO: eliminar no borra la amistad'; end if;
  perform pg_temp.ok('eliminar amigo');
end $$;

-- ─────────────────────────────── 6. solicitudes cruzadas: se aceptan solas
do $$ begin perform public.send_friend_request('am_carla'); end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ begin
  perform public.send_friend_request('am_ana');
  if pg_temp.veo('accepted') <> 1 then raise exception 'FALLO: las solicitudes cruzadas no quedan aceptadas'; end if;
  perform pg_temp.ok('solicitudes cruzadas quedan aceptadas');
end $$;

-- ─────────────────────────────── 7. bloquear y desbloquear (Bloqueados → desbloquear)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('test.bid', public.block_user('00000000-0000-0000-0000-0000000000a3')::text, true);
do $$ begin
  if (select count(*) from public.friendships where status = 'blocked' and requester_id = auth.uid()) <> 1 then
    raise exception 'FALLO: A no ve su bloqueo';
  end if;
  if pg_temp.veo('accepted') <> 0 then raise exception 'FALLO: el bloqueo no borra la amistad'; end if;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ begin
  -- detalle conocido (docs/backend-v2.md): el bloqueado ve la fila; la app la oculta
  if (select count(*) from public.friendships where status = 'blocked' and addressee_id = auth.uid()) <> 1 then
    raise exception 'FALLO: cambio de comportamiento: el bloqueado ya no ve la fila (actualizar docs)';
  end if;
  begin perform public.send_friend_request('am_ana'); raise exception 'FALLO: el bloqueado puede enviar solicitud';
  exception when raise_exception then if sqlerrm not like 'No se puede enviar%' then raise; end if; end;
  begin perform public.remove_friend(current_setting('test.bid')::bigint); raise exception 'FALLO: el bloqueado puede quitar el bloqueo';
  exception when raise_exception then if sqlerrm not like 'No existe esa relación%' then raise; end if; end;
  perform pg_temp.ok('bloquear: el bloqueado no envía solicitudes ni se desbloquea');
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.remove_friend(current_setting('test.bid')::bigint);
  if pg_temp.veo('blocked') <> 0 then raise exception 'FALLO: desbloquear no borra el bloqueo'; end if;
  perform public.send_friend_request('am_carla');
  if pg_temp.veo('pending') <> 1 then raise exception 'FALLO: tras desbloquear no se puede enviar solicitud'; end if;
  perform pg_temp.ok('desbloquear con remove_friend y volver a enviar');
end $$;

-- ─────────────────────────────── 8. sin sesión no hay nada; friendships está en Realtime
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin perform 1 from public.friendships; raise exception 'FALLO: anon lee friendships';
  exception when insufficient_privilege then null; end;
  begin perform public.send_friend_request('am_ana'); raise exception 'FALLO: anon envía solicitudes';
  exception when insufficient_privilege then null; end;
  perform pg_temp.ok('anon no lee ni envía');
end $$;
reset role;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    raise exception 'FALLO: friendships no está en la publicación de Realtime';
  end if;
  perform pg_temp.ok('friendships publicada en Realtime');
end $$;

select current_setting('test.informe') || 'TODOS LOS TESTS OK' as informe;
rollback;
