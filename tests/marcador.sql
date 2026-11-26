-- Prueba del marcador, las monedas online y los logros online (3d, migración 20261128120000_marcador.sql).
--
-- Cómo ejecutarlo: SQL Editor de Supabase (rol postgres), todo el archivo de una vez, con la migración aplicada.
-- Antes de aplicarla se puede probar igual poniendo el contenido de la migración justo después de «begin;».
-- Va dentro de una transacción que termina en ROLLBACK: no deja usuarios ni datos.
-- Si algo falla, se detiene con «FALLO: …». Si todo va bien, la última consulta devuelve el informe.
-- Dentro de una transacción now() no avanza: todas las partidas son «del mismo día».
--
-- Usuarios: M1, M2 (rivales habituales) y M3 (otro rival e intruso).

begin;
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
-- partida terminada con los puntos del motor (pa para a, pb para b); con pb2 distinto, b informa otra cosa (disputed)
create function pg_temp.jugar(a text, b text, pa int, pb int, pb2 int default null) returns uuid language plpgsql as $$
declare m uuid := pg_temp.partida(a, b);
        s jsonb := jsonb_build_object(pg_temp.uid(a)::text, pa, pg_temp.uid(b)::text, pb);
begin
  perform pg_temp.como(a); perform public.report_result(m, s);
  perform pg_temp.como(b);
  perform public.report_result(m, case when pb2 is null then s else jsonb_build_object(pg_temp.uid(a)::text, pa, pg_temp.uid(b)::text, pb2) end);
  return m;
end $$;
create function pg_temp.puntos(u text) returns int language sql as $$ select coalesce((select puntos from public.scores where user_id = pg_temp.uid(u)), 0) $$;
create function pg_temp.monedas(u text) returns int language sql as $$ select coalesce((select monedas from public.wallets where user_id = pg_temp.uid(u)), 0) $$;
create function pg_temp.premios(m uuid) returns jsonb language sql as
  $$ select payload -> 'premios' from public.match_actions where match_id = m and kind = 'fin' $$;
create function pg_temp.mon_partida(m uuid, u text) returns int language sql as
  $$ select coalesce(sum(delta), 0)::int from public.coin_movements where match_id = m and user_id = pg_temp.uid(u) and motivo = 'partida_online' $$;
create function pg_temp.logros(u text) returns text language sql as
  $$ select coalesce(string_agg(achievement_id, ',' order by achievement_id), '') from public.user_achievements where user_id = pg_temp.uid(u) $$;

set local role authenticated;

-- ─────────────────────────────── 1. victoria y derrota (y suelo de 0)
select set_config('test.m1', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);
reset role;
do $$ declare p jsonb := pg_temp.premios(current_setting('test.m1')::uuid); begin
  if pg_temp.puntos('d1') <> 30 or pg_temp.puntos('d2') <> 0 then raise exception 'FALLO 1: puntos % %', pg_temp.puntos('d1'), pg_temp.puntos('d2'); end if;
  if (select delta from public.score_changes where match_id = current_setting('test.m1')::uuid and user_id = pg_temp.uid('d2')) <> 0
     or (select resultado from public.score_changes where match_id = current_setting('test.m1')::uuid and user_id = pg_temp.uid('d2')) <> 'loss' then
    raise exception 'FALLO 1: el perdedor con 0 puntos no se queda en 0 (delta real 0)'; end if;
  if pg_temp.mon_partida(current_setting('test.m1')::uuid, 'd1') <> 50 or pg_temp.mon_partida(current_setting('test.m1')::uuid, 'd2') <> 20 then
    raise exception 'FALLO 1: monedas de la partida'; end if;
  -- primera victoria: logro con 20 monedas
  if pg_temp.logros('d1') <> 'online_primera_victoria' or pg_temp.monedas('d1') <> 70 or pg_temp.monedas('d2') <> 20 then
    raise exception 'FALLO 1: logro o saldo: % % %', pg_temp.logros('d1'), pg_temp.monedas('d1'), pg_temp.monedas('d2'); end if;
  if p -> pg_temp.uid('d1')::text <> '{"resultado":"win","puntos":30,"total":30,"monedas":50,"logros":[{"id":"online_primera_victoria","nombre":"Primera victoria online","monedas":20}]}'::jsonb
     or p -> pg_temp.uid('d2')::text <> '{"resultado":"loss","puntos":0,"total":0,"monedas":20,"logros":[]}'::jsonb then
    raise exception 'FALLO 1: premios en la jugada fin: %', p; end if;
  perform pg_temp.ok('victoria +30 y 50 monedas (+20 del logro «Primera victoria online»); derrota −5 con suelo de 0 y 20 monedas; la jugada «fin» lleva los premios');
end $$;
set local role authenticated;

-- ─────────────────────────────── 2. empate: +30 para los dos y 20 monedas, sin extras
select set_config('test.m2', pg_temp.jugar('d1', 'd2', 500, 500)::text, true);
reset role;
do $$ begin
  if (select winner_id from public.matches where id = current_setting('test.m2')::uuid) is not null then raise exception 'FALLO 2: el empate tiene ganador'; end if;
  if pg_temp.puntos('d1') <> 60 or pg_temp.puntos('d2') <> 30 then raise exception 'FALLO 2: puntos % %', pg_temp.puntos('d1'), pg_temp.puntos('d2'); end if;
  if pg_temp.mon_partida(current_setting('test.m2')::uuid, 'd1') <> 20 or pg_temp.mon_partida(current_setting('test.m2')::uuid, 'd2') <> 20 then raise exception 'FALLO 2: monedas'; end if;
  if (select count(*) from public.score_changes where match_id = current_setting('test.m2')::uuid and resultado = 'draw') <> 2 then raise exception 'FALLO 2: resultado draw'; end if;
  if (select valor from public.user_progress where user_id = pg_temp.uid('d1') and metrica = 'racha_online') <> 0 then raise exception 'FALLO 2: el empate no corta la racha'; end if;
  perform pg_temp.ok('empate: +30 para los dos, 20 monedas cada uno, sin ganador; corta la racha');
end $$;
set local role authenticated;

-- ─────────────────────────────── 3. disputed: no cambia nada
select set_config('test.m3', pg_temp.jugar('d1', 'd2', 700, 300, 310)::text, true);
reset role;
do $$ begin
  if (select finish_reason from public.matches where id = current_setting('test.m3')::uuid) <> 'disputed' then raise exception 'FALLO 3: no es disputed'; end if;
  if exists (select 1 from public.score_changes where match_id = current_setting('test.m3')::uuid)
     or exists (select 1 from public.coin_movements where match_id = current_setting('test.m3')::uuid)
     or pg_temp.puntos('d1') <> 60 or pg_temp.puntos('d2') <> 30 or pg_temp.monedas('d1') <> 90 or pg_temp.monedas('d2') <> 40 then
    raise exception 'FALLO 3: disputed cambió algo'; end if;
  if pg_temp.premios(current_setting('test.m3')::uuid) <> '{}'::jsonb then raise exception 'FALLO 3: premios %', pg_temp.premios(current_setting('test.m3')::uuid); end if;
  if (select valor from public.user_progress where user_id = pg_temp.uid('d1') and metrica = 'partidas_online') <> 2 then raise exception 'FALLO 3: disputed cuenta como partida'; end if;
  perform pg_temp.ok('disputed: sin puntos, sin monedas, sin progreso y «fin» con premios vacíos');
end $$;
set local role authenticated;

-- ─────────────────────────────── 4. abandono = derrota (−5) y 0 monedas; el rival gana
select set_config('test.m4', pg_temp.partida('d1', 'd2')::text, true);
select pg_temp.como('d2');
select public.leave_match(current_setting('test.m4')::uuid);
reset role;
do $$ begin
  if (select finish_reason || '/' || winner_id from public.matches where id = current_setting('test.m4')::uuid) <> 'forfeit/' || pg_temp.uid('d1') then raise exception 'FALLO 4: no es forfeit con ganador d1'; end if;
  if pg_temp.puntos('d1') <> 90 or pg_temp.puntos('d2') <> 25 then raise exception 'FALLO 4: puntos % %', pg_temp.puntos('d1'), pg_temp.puntos('d2'); end if;
  if pg_temp.mon_partida(current_setting('test.m4')::uuid, 'd1') <> 50 or pg_temp.mon_partida(current_setting('test.m4')::uuid, 'd2') <> 0 then raise exception 'FALLO 4: monedas'; end if;
  if (pg_temp.premios(current_setting('test.m4')::uuid) -> pg_temp.uid('d2')::text ->> 'monedas')::int <> 0 then raise exception 'FALLO 4: premios'; end if;
  perform pg_temp.ok('abandono: quien abandona −5 y 0 monedas; el rival +30 y 50 monedas');
end $$;

-- ─────────────────────────────── 5. cobro único
do $$ declare antes jsonb; begin
  antes := (select jsonb_build_object('p1', pg_temp.puntos('d1'), 'p2', pg_temp.puntos('d2'), 'm1', pg_temp.monedas('d1'), 'm2', pg_temp.monedas('d2'),
            'mov', (select count(*) from public.coin_movements), 'sc', (select count(*) from public.score_changes)));
  if private.apply_match_rewards(current_setting('test.m1')::uuid, pg_temp.uid('d1'), 'completed') <> '{}'::jsonb then raise exception 'FALLO 5: repartió dos veces'; end if;
  perform private.finish_match(current_setting('test.m1')::uuid, pg_temp.uid('d1'), 'completed');
  if antes <> (select jsonb_build_object('p1', pg_temp.puntos('d1'), 'p2', pg_temp.puntos('d2'), 'm1', pg_temp.monedas('d1'), 'm2', pg_temp.monedas('d2'),
            'mov', (select count(*) from public.coin_movements), 'sc', (select count(*) from public.score_changes))) then raise exception 'FALLO 5: algo cambió'; end if;
  begin
    insert into public.coin_movements (user_id, delta, motivo, match_id) values (pg_temp.uid('d1'), 50, 'partida_online', current_setting('test.m1')::uuid);
    raise exception 'FALLO 5: se cobró dos veces la misma partida';
  exception when unique_violation then null; end;
  begin
    insert into public.score_changes (match_id, user_id, antes, despues, delta, resultado) values (current_setting('test.m1')::uuid, pg_temp.uid('d1'), 0, 30, 30, 'win');
    raise exception 'FALLO 5: la misma partida puntuó dos veces';
  exception when unique_violation then null; end;
  perform pg_temp.ok('cobro único: repetir el reparto o finish_match no cambia nada; los índices únicos lo impiden también a mano');
end $$;
set local role authenticated;

-- ─────────────────────────────── 6. límite: 5 partidas con premio al día contra el mismo rival (los puntos cuentan siempre)
-- hasta aquí, con premio: d1 → m1, m2, m4 (3); d2 → m1, m2 (2)
select set_config('test.m5', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);   -- d1 4.ª, d2 3.ª
select set_config('test.m6', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);   -- d1 5.ª, d2 4.ª
select set_config('test.m7', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);   -- d1 sin monedas, d2 5.ª
select set_config('test.m8', pg_temp.jugar('d1', 'd2', 900, 400)::text, true);   -- los dos sin monedas
select set_config('test.m9', pg_temp.jugar('d1', 'd3', 900, 400)::text, true);   -- otro rival: d1 vuelve a cobrar
reset role;
do $$ begin
  if pg_temp.mon_partida(current_setting('test.m6')::uuid, 'd1') <> 50 or pg_temp.mon_partida(current_setting('test.m7')::uuid, 'd1') <> 0
     or pg_temp.mon_partida(current_setting('test.m8')::uuid, 'd1') <> 0 then raise exception 'FALLO 6: límite de d1'; end if;
  if pg_temp.mon_partida(current_setting('test.m7')::uuid, 'd2') <> 20 or pg_temp.mon_partida(current_setting('test.m8')::uuid, 'd2') <> 0 then raise exception 'FALLO 6: límite de d2'; end if;
  if (select delta from public.score_changes where match_id = current_setting('test.m8')::uuid and user_id = pg_temp.uid('d1')) <> 30 then raise exception 'FALLO 6: sin monedas tampoco hubo puntos'; end if;
  if (pg_temp.premios(current_setting('test.m8')::uuid) -> pg_temp.uid('d1')::text ->> 'monedas')::int <> 0 then raise exception 'FALLO 6: premios de m8'; end if;
  if pg_temp.mon_partida(current_setting('test.m9')::uuid, 'd1') <> 50 or pg_temp.mon_partida(current_setting('test.m9')::uuid, 'd3') <> 20 then raise exception 'FALLO 6: con otro rival'; end if;
  perform pg_temp.ok('límite diario: a partir de la 6.ª partida con premio contra el mismo rival, 0 monedas (los puntos siguen); con otro rival, se cobra');
end $$;

-- ─────────────────────────────── 7. logros: Bronce, 5 seguidas y 10 victorias, una sola vez y con 20 monedas
-- victorias de d1: m1, m4, m5, m6, m7, m8, m9 = 7 (racha desde m4: 6); puntos: 90 + 5 × 30 = 240
do $$ begin
  if pg_temp.puntos('d1') <> 240 then raise exception 'FALLO 7: puntos de d1 %', pg_temp.puntos('d1'); end if;
  if pg_temp.logros('d1') <> 'online_bronce,online_primera_victoria,online_racha_5' then raise exception 'FALLO 7: logros de d1: %', pg_temp.logros('d1'); end if;
  if (select match_id from public.user_achievements where user_id = pg_temp.uid('d1') and achievement_id = 'online_bronce') <> current_setting('test.m5')::uuid
     or (select match_id from public.user_achievements where user_id = pg_temp.uid('d1') and achievement_id = 'online_racha_5') <> current_setting('test.m8')::uuid then
    raise exception 'FALLO 7: partida en que se consiguió cada logro'; end if;
  if not (pg_temp.premios(current_setting('test.m5')::uuid) -> pg_temp.uid('d1')::text -> 'logros') @> '[{"id":"online_bronce"}]' then raise exception 'FALLO 7: premios de m5'; end if;
end $$;
set local role authenticated;
select pg_temp.jugar('d1', 'd3', 900, 400); select pg_temp.jugar('d1', 'd3', 900, 400);
select set_config('test.m12', pg_temp.jugar('d1', 'd3', 900, 400)::text, true);   -- 10.ª victoria
select pg_temp.jugar('d1', 'd3', 900, 400);                                        -- 11.ª: ningún logro nuevo
reset role;
do $$ begin
  if pg_temp.logros('d1') <> 'online_10_victorias,online_bronce,online_primera_victoria,online_racha_5' then raise exception 'FALLO 7: logros finales: %', pg_temp.logros('d1'); end if;
  if (select match_id from public.user_achievements where user_id = pg_temp.uid('d1') and achievement_id = 'online_10_victorias') <> current_setting('test.m12')::uuid then raise exception 'FALLO 7: 10 victorias'; end if;
  if (select count(*) from public.coin_movements where user_id = pg_temp.uid('d1') and motivo = 'logro') <> 4
     or (select sum(delta) from public.coin_movements where user_id = pg_temp.uid('d1') and motivo = 'logro') <> 80 then raise exception 'FALLO 7: monedas de logros'; end if;
  if pg_temp.logros('d2') <> '' then raise exception 'FALLO 7: d2 sin victorias tiene logros: %', pg_temp.logros('d2'); end if;
  perform pg_temp.ok('logros: Bronce (en la partida que llega a 100), 5 seguidas, 10 victorias; cada uno una vez y con 20 monedas');
end $$;

-- ─────────────────────────────── 8. el saldo es la suma de los movimientos
do $$ begin
  if exists (select 1 from public.wallets w where w.user_id in (pg_temp.uid('d1'), pg_temp.uid('d2'), pg_temp.uid('d3'))
              and w.monedas <> (select sum(delta) from public.coin_movements c where c.user_id = w.user_id)) then
    raise exception 'FALLO 8: wallets.monedas no coincide con coin_movements'; end if;
  if exists (select 1 from public.scores s where s.user_id in (pg_temp.uid('d1'), pg_temp.uid('d2'), pg_temp.uid('d3'))
              and s.puntos <> (select sum(delta) from public.score_changes c where c.user_id = s.user_id)) then
    raise exception 'FALLO 8: scores.puntos no coincide con score_changes'; end if;
  perform pg_temp.ok('wallets = suma de coin_movements y scores = suma de score_changes');
end $$;

-- ─────────────────────────────── 9. el cliente solo lee (RLS)
set local role authenticated;
do $$ begin
  perform pg_temp.como('d3');
  if exists (select 1 from public.wallets where user_id <> pg_temp.uid('d3')) or exists (select 1 from public.coin_movements where user_id <> pg_temp.uid('d3'))
     or exists (select 1 from public.user_progress where user_id <> pg_temp.uid('d3')) or exists (select 1 from public.user_achievements where user_id <> pg_temp.uid('d3')) then
    raise exception 'FALLO 9: d3 lee monedas, progreso o logros ajenos'; end if;
  if exists (select 1 from public.score_changes where match_id = current_setting('test.m1')::uuid) then raise exception 'FALLO 9: d3 lee los puntos de una partida ajena'; end if;
  if (select count(*) from public.scores where user_id in (pg_temp.uid('d1'), pg_temp.uid('d2'))) <> 2
     or (select count(*) from public.game_config) < 3 or (select count(*) from public.achievements) < 4 then raise exception 'FALLO 9: d3 no lee la clasificación, la configuración o los logros'; end if;
  perform pg_temp.como('d2');
  if (select count(*) from public.score_changes where match_id = current_setting('test.m1')::uuid) <> 2 then raise exception 'FALLO 9: d2 no ve los puntos de su partida'; end if;
  begin update public.wallets set monedas = 9999 where user_id = pg_temp.uid('d2'); raise exception 'FALLO 9: el cliente cambió su saldo';
  exception when insufficient_privilege then null; end;
  begin insert into public.coin_movements (user_id, delta, motivo) values (pg_temp.uid('d2'), 100, 'ajuste'); raise exception 'FALLO 9: el cliente se dio monedas';
  exception when insufficient_privilege then null; end;
  begin update public.scores set puntos = 999 where user_id = pg_temp.uid('d2'); raise exception 'FALLO 9: el cliente cambió sus puntos';
  exception when insufficient_privilege then null; end;
  begin insert into public.user_achievements (user_id, achievement_id) values (pg_temp.uid('d2'), 'online_10_victorias'); raise exception 'FALLO 9: el cliente se dio un logro';
  exception when insufficient_privilege then null; end;
  begin update public.game_config set valor = '{}' where clave = 'puntos_1v1'; raise exception 'FALLO 9: el cliente cambió la configuración';
  exception when insufficient_privilege then null; end;
  begin perform private.apply_match_rewards(current_setting('test.m1')::uuid, pg_temp.uid('d2'), 'completed'); raise exception 'FALLO 9: el cliente llamó al reparto';
  exception when insufficient_privilege then null; end;
  perform pg_temp.ok('RLS: saldo, movimientos, progreso y logros solo los ve su dueño; clasificación, configuración y logros disponibles para todos; nada se escribe desde el cliente');
end $$;
reset role;

select replace(current_setting('test.informe'), ' | ', E'\n') as informe;
rollback;
