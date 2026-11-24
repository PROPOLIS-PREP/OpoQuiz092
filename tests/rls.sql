-- Prueba de RLS y permisos del backend v2 (patrullan2-dev).
-- Demuestra que un usuario no ve ni toca los datos de otro y que nadie lee las respuestas correctas antes de tiempo.
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez.
-- Va dentro de una transacción que termina en ROLLBACK: no deja usuarios ni datos.
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, termina con «TODOS LOS TESTS OK».
--
-- Usuarios: A (ana), B (berto) y C (carla, la intrusa).

begin;

-- ─────────────────────────────── preparación (como postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@test.local',   '{"full_name":"Ana"}',   now(), now()),
       ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'berto@test.local', '{"full_name":"Berto"}', now(), now()),
       ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carla@test.local', '{}',                    now(), now());

do $$ begin
  if (select count(*) from public.profiles where id in ('00000000-0000-0000-0000-00000000000a',
      '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c')) <> 3 then
    raise exception 'FALLO: el trigger no creó los 3 perfiles';
  end if;
  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000a'
             and (username not like 'agente\_%' or not username_provisional or display_name <> 'Ana')) then
    raise exception 'FALLO: el perfil provisional no es el esperado';
  end if;
  raise notice 'OK  el registro crea el perfil con username provisional';
end $$;

-- preguntas de prueba (por si el banco aún no está cargado): 2 por nivel, la correcta es la opción 1
insert into public.questions (id, bloque, tema, nivel, texto, opciones, respuesta_correcta, explicacion)
select 'TEST-' || n || '-' || k, 'zz_prueba', 1, n, 'Pregunta de prueba ' || n || '-' || k,
       '["A","B","C","D"]'::jsonb, 1, 'Explicación de prueba'
  from generate_series(1, 7) n, generate_series(1, 2) k
on conflict (id) do nothing;

-- ─────────────────────────────── perfiles
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
update public.profiles set username = 'ana_test' where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set display_name = 'Hackeado' where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select username_provisional from public.my_profile()) then raise exception 'FALLO: cambiar el username no quita el provisional'; end if;
  raise notice 'OK  cada uno cambia su username y deja de ser provisional';
end $$;
do $$ begin
  begin
    perform username_provisional from public.profiles limit 1;
    raise exception 'FALLO: se puede leer una columna no pública de profiles';
  exception when insufficient_privilege then raise notice 'OK  profiles solo expone las columnas públicas';
  end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
update public.profiles set username = 'berto_test' where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') <> 'Berto' then
    raise exception 'FALLO: A pudo editar el perfil de B';
  end if;
  raise notice 'OK  nadie edita el perfil de otro';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
update public.profiles set username = 'carla_test' where id = '00000000-0000-0000-0000-00000000000c';

-- ─────────────────────────────── amistades (mutuo acuerdo)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select set_config('test.fid', public.send_friend_request('berto_test')::text, true);
do $$ begin
  begin
    perform public.send_friend_request('ana_test');
    raise exception 'FALLO: alguien se envió una solicitud a sí mismo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform public.respond_friend_request(current_setting('test.fid')::bigint, true);
    raise exception 'FALLO: quien envía la solicitud pudo aceptarla';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  if (select status from public.friendships where id = current_setting('test.fid')::bigint) <> 'pending' then
    raise exception 'FALLO: la amistad no espera a la aceptación';
  end if;
  raise notice 'OK  sin amistad consigo mismo y solo el destinatario acepta';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.friendships) <> 0 then raise exception 'FALLO: C ve la amistad de A y B'; end if;
  begin
    perform public.respond_friend_request(current_setting('test.fid')::bigint, true);
    raise exception 'FALLO: C aceptó una solicitud ajena';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    insert into public.friendships (requester_id, addressee_id)
    values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a');
    raise exception 'FALLO: se puede insertar en friendships sin pasar por las funciones';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK  C no ve ni toca la amistad de A y B';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select public.respond_friend_request(current_setting('test.fid')::bigint, true);
do $$ begin
  if (select status from public.friendships where id = current_setting('test.fid')::bigint) <> 'accepted' then
    raise exception 'FALLO: B no pudo aceptar';
  end if;
  raise notice 'OK  el destinatario acepta la solicitud';
end $$;

-- ─────────────────────────────── grupos (solo amigos y aceptando)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select set_config('test.gid', public.create_group('Grupo de prueba')::text, true);
do $$ begin
  begin
    perform public.invite_to_group(current_setting('test.gid')::bigint, 'carla_test');
    raise exception 'FALLO: se invitó a un grupo a quien no es amigo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  raise notice 'OK  solo se invita a amigos';
end $$;
select public.invite_to_group(current_setting('test.gid')::bigint, 'berto_test');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.group_invitations where user_id = '00000000-0000-0000-0000-00000000000b') <> 1 then
    raise exception 'FALLO: B no ve su invitación';
  end if;
  if (select count(*) from public.groups) <> 1 then raise exception 'FALLO: B no ve el grupo al que le invitan'; end if;
  if (select count(*) from public.group_members) <> 0 then raise exception 'FALLO: B ve los miembros antes de aceptar'; end if;
  raise notice 'OK  el invitado ve la invitación y el grupo, pero no entra hasta aceptar';
end $$;
select public.respond_group_invitation(current_setting('test.gid')::bigint, true);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.groups) <> 0 or (select count(*) from public.group_members) <> 0
     or (select count(*) from public.group_invitations) <> 0 then
    raise exception 'FALLO: C ve un grupo del que no es miembro';
  end if;
  begin
    perform public.respond_group_invitation(current_setting('test.gid')::bigint, true);
    raise exception 'FALLO: C entró en un grupo sin invitación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  raise notice 'OK  C no ve el grupo ni puede entrar';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.group_members where group_id = current_setting('test.gid')::bigint) <> 2 then
    raise exception 'FALLO: B no está en el grupo tras aceptar';
  end if;
  begin
    perform public.invite_to_group(current_setting('test.gid')::bigint, 'ana_test');
    raise exception 'FALLO: un miembro que no es admin invitó';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  raise notice 'OK  aceptar te hace miembro y solo los admins invitan';
end $$;

-- ─────────────────────────────── banco de preguntas
do $$ begin
  begin
    perform 1 from public.questions limit 1;
    raise exception 'FALLO: un usuario lee la tabla questions';
  exception when insufficient_privilege then raise notice 'OK  questions no es legible desde el cliente';
  end;
end $$;

-- ─────────────────────────────── partida: sala
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select set_config('test.mid', match_id::text, true), set_config('test.code', code, true)
  from public.create_match('ladder', 2, 1);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select public.join_match(lower(current_setting('test.code')));
do $$ begin
  begin
    perform public.start_match(current_setting('test.mid')::uuid);
    raise exception 'FALLO: alguien que no es el anfitrión empezó la partida';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  raise notice 'OK  solo el anfitrión empieza la partida';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.start_match(current_setting('test.mid')::uuid);
do $$ begin
  if (select seed from public.matches where id = current_setting('test.mid')::uuid) is null then
    raise exception 'FALLO: la partida empezó sin semilla';
  end if;
  if (select kind from public.match_actions where match_id = current_setting('test.mid')::uuid and seq = 0) <> 'inicio' then
    raise exception 'FALLO: el registro no empieza con la jugada de inicio';
  end if;
  raise notice 'OK  la partida empieza con semilla y jugada de inicio';
end $$;

-- ─────────────────────────────── partida: jugadas y pregunta
select public.submit_action(current_setting('test.mid')::uuid, 1, 'dado', '{"valor":4}');
do $$ begin
  begin
    perform public.submit_action(current_setting('test.mid')::uuid, 1, 'dado', '{"valor":6}');
    raise exception 'FALLO: se aceptó una jugada con un número de secuencia ya usado';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform public.submit_action(current_setting('test.mid')::uuid, 2, 'resultado', '{"result":"correct"}');
    raise exception 'FALLO: un jugador anotó una jugada reservada al servidor';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  raise notice 'OK  el registro de jugadas mantiene el orden y reserva las del servidor';
end $$;
select set_config('test.qi', public.draw_question(current_setting('test.mid')::uuid, 'zz_prueba', 3, 25, 'turno')::text, true);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.matches) <> 0 or (select count(*) from public.match_players) <> 0
     or (select count(*) from public.match_actions) <> 0 then
    raise exception 'FALLO: C ve una partida en la que no juega';
  end if;
  begin
    perform * from public.get_current_question(current_setting('test.mid')::uuid);
    raise exception 'FALLO: C obtuvo la pregunta de una partida ajena';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform public.submit_action(current_setting('test.mid')::uuid, 3, 'dado', '{}');
    raise exception 'FALLO: C anotó una jugada en una partida ajena';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  raise notice 'OK  C no ve ni toca la partida de A y B';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$ declare r record; begin
  begin
    perform 1 from public.match_questions limit 1;
    raise exception 'FALLO: un jugador lee match_questions';
  exception when insufficient_privilege then null;
  end;
  select * into r from public.get_current_question(current_setting('test.mid')::uuid);
  if r.player_id <> '00000000-0000-0000-0000-00000000000a' then raise exception 'FALLO: la pregunta no es de A'; end if;
  if r.opened then raise exception 'FALLO: la pregunta se abrió al pedirla otro jugador'; end if;
  begin
    perform public.submit_answer(current_setting('test.mid')::uuid, r.question_index, 1);
    raise exception 'FALLO: B respondió la pregunta de A';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    insert into public.match_answers (match_id, question_index, user_id, option_chosen)
    values (current_setting('test.mid')::uuid, r.question_index, '00000000-0000-0000-0000-00000000000a', 1);
    raise exception 'FALLO: B insertó una respuesta en nombre de A';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  if (select count(*) from public.get_question_result(current_setting('test.mid')::uuid, r.question_index)) <> 0 then
    raise exception 'FALLO: se revela la respuesta de una pregunta abierta';
  end if;
  raise notice 'OK  la respuesta correcta no se revela antes de cerrar y nadie responde por otro';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$ declare r record; d smallint[]; s record; begin
  select * into r from public.get_current_question(current_setting('test.mid')::uuid);
  if not r.opened then raise exception 'FALLO: la pregunta no se abrió para quien debe responder'; end if;
  d := public.use_lifeline(current_setting('test.mid')::uuid, r.question_index, 'mitad');
  if cardinality(d) <> 2 or 1 = any (d) then raise exception 'FALLO: el 50/50 no quitó dos opciones falsas (%)', d; end if;
  begin
    perform public.use_lifeline(current_setting('test.mid')::uuid, r.question_index, 'mitad');
    raise exception 'FALLO: el 50/50 se usó dos veces en la misma pregunta';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  select * into s from public.submit_answer(current_setting('test.mid')::uuid, r.question_index, 1);
  if not s.correct or s.respuesta_correcta <> 1 then raise exception 'FALLO: la respuesta correcta no se validó bien'; end if;
  begin
    perform public.submit_answer(current_setting('test.mid')::uuid, r.question_index, 1);
    raise exception 'FALLO: se respondió dos veces la misma pregunta';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  if not exists (select 1 from public.match_actions where match_id = current_setting('test.mid')::uuid
                  and kind = 'resultado' and payload ->> 'result' = 'correct') then
    raise exception 'FALLO: el resultado no se anotó en el registro';
  end if;
  raise notice 'OK  50/50, respuesta validada en servidor y resultado en el registro';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.get_question_result(current_setting('test.mid')::uuid, current_setting('test.qi')::integer)) <> 1 then
    raise exception 'FALLO: no se revela el resultado de una pregunta cerrada';
  end if;
  raise notice 'OK  al cerrarse, todos los jugadores ven el resultado';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.match_answers) <> 0 then raise exception 'FALLO: C ve respuestas de otra partida'; end if;
  raise notice 'OK  C no ve las respuestas de A y B';
end $$;

-- ─────────────────────────────── abandono: con 2 jugadores gana el rival
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin
  begin
    perform public.claim_forfeit(current_setting('test.mid')::uuid, '00000000-0000-0000-0000-00000000000a');
    raise exception 'FALLO: se dio por abandonado a un jugador conectado';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;
select public.leave_match(current_setting('test.mid')::uuid);
do $$ declare m record; begin
  select status, winner_id, finish_reason into m from public.matches where id = current_setting('test.mid')::uuid;
  if m.status <> 'finished' or m.winner_id <> '00000000-0000-0000-0000-00000000000a' or m.finish_reason <> 'forfeit' then
    raise exception 'FALLO: al abandonar B no ganó A (%, %, %)', m.status, m.winner_id, m.finish_reason;
  end if;
  raise notice 'OK  quien abandona pierde y, con dos jugadores, gana el rival';
end $$;

-- ─────────────────────────────── anon
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.profiles limit 1;
    raise exception 'FALLO: anon lee profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_match('points', 2, 1);
    raise exception 'FALLO: anon ejecuta funciones';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK  anon no lee tablas ni ejecuta funciones';
end $$;

reset role;
do $$ begin raise notice 'TODOS LOS TESTS OK'; end $$;
rollback;
