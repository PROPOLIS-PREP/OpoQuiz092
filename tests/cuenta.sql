-- Prueba de la fase 1 del cliente online (cuenta y perfil) contra patrullan2-dev.
-- Reproduce lo que hace online/cuenta.js: my_profile() al iniciar sesión y
-- «update profiles set username = … where id = <yo>» al guardar el nombre de agente.
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez.
-- Va dentro de una transacción que termina en ROLLBACK: no deja usuarios ni datos.
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe.

begin;
select set_config('test.informe', '', true);

-- ─────────────────────────────── preparación (como postgres): dos usuarios confirmados
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cuenta1@test.local', now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cuenta2@test.local', now(), '{}', now(), now());

-- ─────────────────────────────── 1. my_profile() tras el registro: nombre provisional
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
do $$ declare p public.profiles; n int; begin
  select count(*) into n from public.my_profile();
  if n <> 1 then raise exception 'FALLO: my_profile devuelve % filas', n; end if;
  select * into p from public.my_profile();
  if p.username !~ '^agente_[0-9a-f]{8}$' or not p.username_provisional then
    raise exception 'FALLO: el perfil nuevo no tiene nombre provisional agente_xxxxxxxx';
  end if;
  perform set_config('test.informe', current_setting('test.informe') || 'OK my_profile devuelve el perfil provisional | ', true);
end $$;

-- ─────────────────────────────── 2. guardar un nombre válido
update public.profiles set username = 'Agente_Prueba1' where id = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  if (select username from public.my_profile()) <> 'Agente_Prueba1' then raise exception 'FALLO: no se guardó el nombre'; end if;
  if (select username_provisional from public.my_profile()) then raise exception 'FALLO: sigue marcado como provisional'; end if;
  perform set_config('test.informe', current_setting('test.informe') || 'OK nombre válido guardado y deja de ser provisional | ', true);
end $$;

-- ─────────────────────────────── 3. nombres con formato inválido → 23514
do $$ declare v text; begin
  foreach v in array array['ab', 'José', 'con espacio', 'demasiado_largo_para_ser_valido', 'guion-medio'] loop
    begin
      update public.profiles set username = v where id = '00000000-0000-0000-0000-0000000000c1';
      raise exception 'FALLO: se aceptó el nombre inválido «%»', v;
    exception when check_violation then null;
    end;
  end loop;
  perform set_config('test.informe', current_setting('test.informe') || 'OK formato inválido rechazado (23514) | ', true);
end $$;

-- ─────────────────────────────── 4. nombre repetido (sin distinguir mayúsculas) → 23505
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
do $$ begin
  begin
    update public.profiles set username = 'agente_prueba1' where id = '00000000-0000-0000-0000-0000000000c2';
    raise exception 'FALLO: se aceptó un nombre repetido';
  exception when unique_violation then null;
  end;
  perform set_config('test.informe', current_setting('test.informe') || 'OK nombre repetido rechazado (23505) | ', true);
end $$;

-- ─────────────────────────────── 5. nadie cambia el nombre de otro ni marca el suyo como provisional
do $$ declare n int; begin
  update public.profiles set username = 'robado_123' where id = '00000000-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: c2 cambió el nombre de c1'; end if;
  begin
    update public.profiles set username_provisional = true where id = '00000000-0000-0000-0000-0000000000c2';
    raise exception 'FALLO: el cliente puede cambiar username_provisional';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.informe', current_setting('test.informe') || 'OK no se edita el perfil ajeno ni username_provisional | ', true);
end $$;

-- ─────────────────────────────── 6. sin sesión (anon) no hay perfil
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform * from public.my_profile();
    raise exception 'FALLO: anon puede ejecutar my_profile';
  exception when insufficient_privilege then null;
  end;
  begin
    perform username from public.profiles limit 1;
    raise exception 'FALLO: anon puede leer profiles';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.informe', current_setting('test.informe') || 'OK anon no ve perfiles | ', true);
end $$;

reset role;
select current_setting('test.informe') || 'TODOS LOS TESTS OK' as informe;
rollback;
