-- Prueba de la partida online (subfase 3c) contra patrullan2-dev: las RPC que usa online/partida.js, RLS,
-- y que el cliente no puede leer la opción correcta antes de responder.
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez.
-- Va dentro de una transacción que termina en ROLLBACK: no deja usuarios ni datos.
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe.
-- Dentro de una transacción now() no avanza: los plazos y los 60 s sin latido se simulan cambiando
-- closes_at y last_heartbeat como postgres.
--
-- Usuarios: P1 (anfitrión, asiento 0), P2 (rival, asiento 1) y P3 (intruso).

begin;
select set_config('test.informe', '', true);
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_uno@test.local',  now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_dos@test.local',  now(), '{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_tres@test.local', now(), '{}', now(), now());
create function pg_temp.ok(p text) returns void language sql as
  $$ select set_config('test.informe', current_setting('test.informe') || 'OK ' || p || ' | ', true); $$;
create function pg_temp.como(u text) returns void language sql as
  $$ select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000' || u || '","role":"authenticated"}', true); $$;
-- ¿lleva la fila o el json alguna clave que delate la respuesta correcta?
create function pg_temp.delata(j jsonb) returns boolean language sql as
  $$ select j::text ~* '(respuesta_correcta|"correcta"|"correct_option"|"answer")' $$;

set local role authenticated;

-- ─────────────────────────────── 1. sala y comienzo: semilla y orden de los jugadores en la jugada «inicio»
select pg_temp.como('e1');
do $$ declare r record; begin
  select * into r from public.create_match('points', 2, 5);
  perform set_config('test.mid', r.match_id::text, true); perform set_config('test.code', r.code, true);
end $$;
select pg_temp.como('e2');
select public.join_match(current_setting('test.code'));
select pg_temp.como('e1');
select public.start_match(current_setting('test.mid')::uuid);
do $$ declare a record; begin
  select * into a from public.match_actions where match_id = current_setting('test.mid')::uuid and seq = 0;
  if a.kind <> 'inicio' or (a.payload->>'seed') is null or a.payload->>'mode' <> 'points' or (a.payload->>'turns')::int <> 5
     or a.payload->'players' <> '["00000000-0000-0000-0000-0000000000e1","00000000-0000-0000-0000-0000000000e2"]'::jsonb then
    raise exception 'FALLO: la jugada inicio no lleva semilla, modo, turnos y jugadores en orden: %', a.payload;
  end if;
  perform pg_temp.ok('inicio con semilla, modo points, turnos y jugadores por asiento');
end $$;

-- ─────────────────────────────── 2. jugadas del motor: número esperado, reservadas y turno de juego
do $$ begin
  perform public.submit_action(current_setting('test.mid')::uuid, 1, 'tirar', '{}');
  begin perform public.submit_action(current_setting('test.mid')::uuid, 1, 'tirar', '{}'); raise exception 'FALLO: se aceptó un número de jugada repetido';
  exception when sqlstate '40001' then null; end;
  begin perform public.submit_action(current_setting('test.mid')::uuid, 2, 'resultado', '{}'); raise exception 'FALLO: el cliente anotó una jugada del servidor';
  exception when raise_exception then if sqlerrm not like 'Esa jugada la anota el servidor%' then raise; end if; end;
  perform pg_temp.ok('submit_action: número esperado (40001 si no) y jugadas del servidor reservadas');
end $$;
do $$ declare k text; n int := 2; begin
  foreach k in array array['desplegar','fin_despliegue','examen','distrito','comprar','fin_comisaria','lanzar','recolocar'] loop
    perform public.submit_action(current_setting('test.mid')::uuid, n, k, '{"x":1}'); n := n + 1;
  end loop;
  if (select count(*) from public.match_actions where match_id = current_setting('test.mid')::uuid) <> 10 then raise exception 'FALLO: no se anotaron las jugadas'; end if;
  perform pg_temp.ok('se anotan desplegar, fin_despliegue, examen, distrito, comprar, fin_comisaria, lanzar y recolocar');
end $$;

-- ─────────────────────────────── 3. pregunta: nadie lee la opción correcta antes de responder
select set_config('test.qi', public.draw_question(current_setting('test.mid')::uuid, 'legislativo', 3, 25, 'turno')::text, true);
do $$ declare a record; begin
  select * into a from public.match_actions where match_id = current_setting('test.mid')::uuid and kind = 'pregunta' order by seq desc limit 1;
  if a.user_id <> '00000000-0000-0000-0000-0000000000e1' or (a.payload->>'nivel_pedido')::int <> 3 or (a.payload->>'segundos')::int <> 25
     or a.payload->>'tipo' <> 'turno' or a.payload->>'bloque' <> 'legislativo' then raise exception 'FALLO: jugada pregunta: %', a.payload; end if;
  if pg_temp.delata(a.payload) then raise exception 'FALLO: la jugada pregunta delata la respuesta'; end if;
  perform pg_temp.ok('draw_question anota pregunta (bloque, nivel pedido, segundos, tipo) sin la respuesta');
end $$;
select pg_temp.como('e2');   -- el rival
do $$ declare r record; begin
  select * into r from public.get_current_question(current_setting('test.mid')::uuid);
  if r.opened then raise exception 'FALLO: la pregunta se abrió al pedirla el rival'; end if;
  if pg_temp.delata(to_jsonb(r)) then raise exception 'FALLO: get_current_question delata la respuesta'; end if;
  if (select count(*) from public.get_question_result(current_setting('test.mid')::uuid, current_setting('test.qi')::int)) <> 0 then
    raise exception 'FALLO: el rival lee el resultado de una pregunta abierta';
  end if;
  begin perform 1 from public.match_questions limit 1; raise exception 'FALLO: se lee match_questions';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.questions limit 1; raise exception 'FALLO: se lee questions';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.match_actions where match_id = current_setting('test.mid')::uuid and pg_temp.delata(payload)) then
    raise exception 'FALLO: alguna jugada del registro delata la respuesta';
  end if;
  perform pg_temp.ok('el rival no abre la pregunta ni lee la respuesta (get_current_question, get_question_result, tablas, registro)');
end $$;
select pg_temp.como('e1');   -- quien responde
do $$ declare r record; d smallint[]; begin
  select * into r from public.get_current_question(current_setting('test.mid')::uuid);
  if not r.opened then raise exception 'FALLO: no se abrió para quien responde'; end if;
  if pg_temp.delata(to_jsonb(r)) then raise exception 'FALLO: quien responde recibe la respuesta al abrir'; end if;
  if (select count(*) from public.get_question_result(current_setting('test.mid')::uuid, r.question_index)) <> 0 then
    raise exception 'FALLO: quien responde lee la respuesta antes de responder';
  end if;
  d := public.use_lifeline(current_setting('test.mid')::uuid, r.question_index, 'mitad');
  if cardinality(d) <> 2 then raise exception 'FALLO: el 50/50 no quitó dos opciones'; end if;
  perform public.use_lifeline(current_setting('test.mid')::uuid, r.question_index, 'tiempo');
  perform public.submit_action(current_setting('test.mid')::uuid, (select max(seq) + 1 from public.match_actions where match_id = current_setting('test.mid')::uuid), 'sirena', '{}');
  if (select count(*) from public.match_actions where match_id = current_setting('test.mid')::uuid and kind in ('comodin', 'sirena')) <> 3 then
    raise exception 'FALLO: comodines y sirena no quedan en el registro';
  end if;
  perform pg_temp.ok('quien responde abre la pregunta sin la respuesta; 50/50, +10 s y sirena quedan en el registro');
end $$;
reset role;
select set_config('test.ok', (select q.respuesta_correcta::text from public.match_questions mq join public.questions q on q.id = mq.question_id
  where mq.match_id = current_setting('test.mid')::uuid and mq.question_index = current_setting('test.qi')::int), true);
set local role authenticated;
select pg_temp.como('e1');
select * from public.submit_answer(current_setting('test.mid')::uuid, current_setting('test.qi')::int, current_setting('test.ok')::int);
select pg_temp.como('e2');
do $$ declare a jsonb; r record; begin
  select payload into a from public.match_actions where match_id = current_setting('test.mid')::uuid and kind = 'resultado' order by seq desc limit 1;
  if a->>'result' <> 'correct' or (a->>'segundos_restantes')::numeric <> 35.0 then raise exception 'FALLO: resultado: %', a; end if;
  select * into r from public.get_question_result(current_setting('test.mid')::uuid, current_setting('test.qi')::int);
  if r.respuesta_correcta <> current_setting('test.ok')::int or r.result <> 'correct' then raise exception 'FALLO: el rival no ve el resultado tras cerrarse'; end if;
  perform pg_temp.ok('tras responder: resultado con segundos_restantes (25 + 10 = 35.0) y la respuesta llega con get_question_result');
end $$;

-- ─────────────────────────────── 4. intruso
select pg_temp.como('e3');
do $$ begin
  if (select count(*) from public.match_actions) <> 0 or (select count(*) from public.matches) <> 0 then raise exception 'FALLO: el intruso ve la partida'; end if;
  begin perform * from public.get_question_result(current_setting('test.mid')::uuid, 0); raise exception 'FALLO: el intruso lee el resultado';
  exception when raise_exception then if sqlerrm not like 'No estás en esa partida%' then raise; end if; end;
  begin perform public.submit_action(current_setting('test.mid')::uuid, 99, 'tirar', '{}'); raise exception 'FALLO: el intruso anota jugadas';
  exception when raise_exception then if sqlerrm not like 'No estás en esa partida%' then raise; end if; end;
  begin perform public.heartbeat(current_setting('test.mid')::uuid); raise exception 'FALLO: el intruso envía latidos';
  exception when raise_exception then if sqlerrm not like 'No estás en esa partida%' then raise; end if; end;
  perform pg_temp.ok('el intruso no ve la partida ni anota jugadas, latidos ni lecturas');
end $$;

-- ─────────────────────────────── 5. plazo vencido: lo cierra cualquier latido
select pg_temp.como('e1');
select set_config('test.qi', public.draw_question(current_setting('test.mid')::uuid, 'policial', 2, 25, 'casilla')::text, true);
select count(*) from public.get_current_question(current_setting('test.mid')::uuid);
reset role;
update public.match_questions set closes_at = now() - interval '1 second' where match_id = current_setting('test.mid')::uuid and question_index = current_setting('test.qi')::int;
set local role authenticated;
select pg_temp.como('e2');
select public.heartbeat(current_setting('test.mid')::uuid);
do $$ declare a jsonb; begin
  select payload into a from public.match_actions where match_id = current_setting('test.mid')::uuid and kind = 'resultado' order by seq desc limit 1;
  if a->>'result' <> 'timeout' or (a->>'segundos_restantes')::numeric <> 0 then raise exception 'FALLO: timeout: %', a; end if;
  perform pg_temp.ok('plazo vencido: el latido del rival lo cierra como timeout con 0 segundos');
end $$;

-- ─────────────────────────────── 6. reclamar la victoria: solo tras 60 s sin latido
do $$ begin
  begin perform public.claim_forfeit(current_setting('test.mid')::uuid, '00000000-0000-0000-0000-0000000000e1'); raise exception 'FALLO: se reclamó contra un jugador conectado';
  exception when raise_exception then if sqlerrm not like 'Ese jugador sigue conectado%' then raise; end if; end;
end $$;
reset role;
update public.match_players set last_heartbeat = now() - interval '61 seconds'
 where match_id = current_setting('test.mid')::uuid and user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.como('e2');
select public.claim_forfeit(current_setting('test.mid')::uuid, '00000000-0000-0000-0000-0000000000e1');
do $$ declare m record; begin
  select status, winner_id, finish_reason into m from public.matches where id = current_setting('test.mid')::uuid;
  if m.status <> 'finished' or m.finish_reason <> 'forfeit' or m.winner_id <> '00000000-0000-0000-0000-0000000000e2' then raise exception 'FALLO: claim_forfeit: % % %', m.status, m.finish_reason, m.winner_id; end if;
  if (select string_agg(kind, ',' order by seq) from (select kind, seq from public.match_actions where match_id = current_setting('test.mid')::uuid order by seq desc limit 2) x) <> 'abandono,fin' then
    raise exception 'FALLO: el registro no termina con abandono y fin';
  end if;
  perform pg_temp.ok('claim_forfeit solo tras 60 s sin latido: gana el rival y el registro acaba en abandono y fin');
end $$;

-- ─────────────────────────────── 7. report_result solo cierra la partida: completed o disputed
select pg_temp.como('e1');
do $$ declare r record; begin
  select * into r from public.create_match('points', 2, 5);
  perform set_config('test.m2', r.match_id::text, true); perform set_config('test.c2', r.code, true);
  select * into r from public.create_match('points', 2, 5);
  perform set_config('test.m3', r.match_id::text, true); perform set_config('test.c3', r.code, true);
end $$;
select pg_temp.como('e2');
select public.join_match(current_setting('test.c2')); select public.join_match(current_setting('test.c3'));
select pg_temp.como('e1');
select public.start_match(current_setting('test.m2')::uuid); select public.start_match(current_setting('test.m3')::uuid);
select public.report_result(current_setting('test.m2')::uuid, '{"00000000-0000-0000-0000-0000000000e1": 900, "00000000-0000-0000-0000-0000000000e2": 400}');
select public.report_result(current_setting('test.m3')::uuid, '{"00000000-0000-0000-0000-0000000000e1": 500, "00000000-0000-0000-0000-0000000000e2": 500}');
select pg_temp.como('e2');
select public.report_result(current_setting('test.m2')::uuid, '{"00000000-0000-0000-0000-0000000000e1": 900, "00000000-0000-0000-0000-0000000000e2": 400}');
select public.report_result(current_setting('test.m3')::uuid, '{"00000000-0000-0000-0000-0000000000e1": 500, "00000000-0000-0000-0000-0000000000e2": 510}');
do $$ declare a record; b record; begin
  select status, finish_reason, winner_id into a from public.matches where id = current_setting('test.m2')::uuid;
  select status, finish_reason, winner_id into b from public.matches where id = current_setting('test.m3')::uuid;
  if a.finish_reason <> 'completed' or a.winner_id <> '00000000-0000-0000-0000-0000000000e1' then raise exception 'FALLO: resultados iguales no cierran como completed'; end if;
  if b.finish_reason <> 'disputed' or b.winner_id is not null then raise exception 'FALLO: resultados distintos no cierran como disputed'; end if;
  perform pg_temp.ok('report_result: iguales → completed con ganador; distintos → disputed sin ganador');
end $$;
reset role;

-- ─────────────────────────────── 8. inactividad: 60 s sin actividad (requiere 20261126120000_inactividad.sql)
-- Si la migración no está aplicada, el bloque se salta y lo anota como pendiente.
do $$ declare r record; m record; v_mid uuid; begin
  if to_regprocedure('public.claim_inactivity(uuid,uuid)') is null then
    perform pg_temp.ok('inactividad: PENDIENTE (migración 20261126120000_inactividad.sql sin aplicar)'); return;
  end if;
  execute 'set local role authenticated';
  perform pg_temp.como('e1');
  select * into r from public.create_match('points', 2, 5); v_mid := r.match_id;
  perform pg_temp.como('e2'); perform public.join_match(r.code);
  perform pg_temp.como('e1'); perform public.start_match(v_mid);
  -- a) recién empezada: nadie puede reclamar (cuenta desde el comienzo aunque la sala esperase mucho)
  execute 'reset role';
  update public.match_players set ultima_actividad_at = now() - interval '30 minutes' where match_id = v_mid;
  execute 'set local role authenticated';
  perform pg_temp.como('e2');
  begin perform public.claim_inactivity(v_mid, '00000000-0000-0000-0000-0000000000e1'); raise exception 'FALLO: se reclamó la inactividad de una partida recién empezada';
  exception when raise_exception then if sqlerrm not like 'Ese jugador sigue activo%' then raise; end if; end;
  -- b) 61 s sin actividad, pero toca la pantalla (mark_activity): la reclamación falla
  execute 'reset role';
  update public.matches set started_at = now() - interval '5 minutes' where id = v_mid;
  update public.match_players set ultima_actividad_at = now() - interval '61 seconds' where match_id = v_mid;
  execute 'set local role authenticated';
  perform pg_temp.como('e1'); perform public.mark_activity(v_mid);
  perform pg_temp.como('e2');
  begin perform public.claim_inactivity(v_mid, '00000000-0000-0000-0000-0000000000e1'); raise exception 'FALLO: se reclamó tras una actividad reciente';
  exception when raise_exception then if sqlerrm not like 'Ese jugador sigue activo%' then raise; end if; end;
  perform pg_temp.ok('inactividad: se cancela con actividad (mark_activity) y no cuenta antes del comienzo');
  -- c) seguridad: no contra uno mismo, ni un intruso, ni anon
  begin perform public.claim_inactivity(v_mid, '00000000-0000-0000-0000-0000000000e2'); raise exception 'FALLO: se reclamó contra uno mismo';
  exception when raise_exception then if sqlerrm not like 'Para abandonar usa leave_match%' then raise; end if; end;
  perform pg_temp.como('e3');
  begin perform public.claim_inactivity(v_mid, '00000000-0000-0000-0000-0000000000e1'); raise exception 'FALLO: un intruso reclamó';
  exception when raise_exception then if sqlerrm not like 'No estás en esa partida%' then raise; end if; end;
  begin perform public.mark_activity(v_mid); raise exception 'FALLO: un intruso registró actividad';
  exception when raise_exception then if sqlerrm not like 'No estás en esa partida%' then raise; end if; end;
  execute 'reset role'; execute 'set local role anon';
  begin perform public.claim_inactivity(v_mid, '00000000-0000-0000-0000-0000000000e1'); raise exception 'FALLO: anon reclamó';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform pg_temp.ok('inactividad: ni contra uno mismo, ni un intruso, ni anon');
  -- d) 61 s sin actividad de verdad: el rival reclama y gana
  update public.match_players set ultima_actividad_at = now() - interval '61 seconds'
   where match_id = v_mid and user_id = '00000000-0000-0000-0000-0000000000e1';
  execute 'set local role authenticated';
  perform pg_temp.como('e2'); perform public.claim_inactivity(v_mid, '00000000-0000-0000-0000-0000000000e1');
  execute 'reset role';
  select status, finish_reason, winner_id into m from public.matches where id = v_mid;
  if m.status <> 'finished' or m.finish_reason <> 'forfeit' or m.winner_id <> '00000000-0000-0000-0000-0000000000e2' then
    raise exception 'FALLO: claim_inactivity no dio la victoria al rival: % % %', m.status, m.finish_reason, m.winner_id;
  end if;
  if (select string_agg(kind, ',' order by seq) from (select kind, seq from public.match_actions where match_id = v_mid order by seq desc limit 2) x) <> 'abandono,fin' then
    raise exception 'FALLO: el registro no acaba en abandono y fin';
  end if;
  perform pg_temp.ok('inactividad: a los 60 s sin actividad, claim_inactivity da la victoria al rival');
end $$;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public'
              and table_name in ('scores', 'score_changes', 'wallets', 'coin_movements', 'achievements', 'user_achievements', 'user_progress', 'game_config')) then
    raise exception 'FALLO: existe alguna tabla de puntuación, monedas o logros (no debería en la 3c)';
  end if;
  perform pg_temp.ok('no existen tablas de marcador, monedas ni logros: report_result solo cierra la partida');
end $$;

select current_setting('test.informe') || 'TODOS LOS TESTS OK' as informe;
rollback;
