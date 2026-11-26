-- Inactividad en las partidas online (3c), versión A: un jugador con una acción pendiente que no toca la pantalla
-- durante 60 s pierde. Es distinto del corte de red (claim_forfeit, 60 s sin latido): aquí la pestaña sigue abierta.
--
-- El servidor no guarda el estado del juego (lo lleva el motor de cada móvil): por eso cada móvil declara si su
-- pantalla espera algo suyo (p_pendiente). Ese dato puede falsearse; aceptado para la beta (docs/backend-v2.md).
--
-- · match_players.ultima_actividad_at: último toque, clic o tecla (o espera sin nada pendiente).
-- · match_players.pendiente_desde: desde cuándo la pantalla del jugador espera algo suyo; null si nada.
-- · mark_activity(match, p_pendiente, p_actividad):
--     - siempre cuenta como latido (last_heartbeat, connected) y cierra una pregunta vencida (advance_match);
--     - p_actividad (por defecto true): renueva ultima_actividad_at. El latido de un jugador con algo pendiente lo
--       envía a false (informa de que está pendiente sin contar como actividad);
--     - p_pendiente: true fija pendiente_desde si estaba vacío; false lo limpia; null no lo toca.
-- · claim_inactivity(match, jugador): un rival da la partida por perdida al jugador si
--     a) tiene una acción pendiente (pendiente_desde, o una pregunta suya abierta y en plazo) y han pasado 60 s
--        desde lo más reciente entre su última actividad, el inicio de lo pendiente y el comienzo de la partida; o
--     b) no tiene nada pendiente, pero lleva 180 s sin actividad (umbral de seguridad contra bloqueos).
--   Si no: «Ese jugador sigue activo» (a) o «Ese jugador no tiene ninguna acción pendiente» (b).
-- No es destructiva: añade dos columnas con valor por defecto y funciones nuevas.

alter table public.match_players add column ultima_actividad_at timestamptz not null default now();
alter table public.match_players add column pendiente_desde timestamptz;
comment on column public.match_players.ultima_actividad_at is
  'Último toque, clic o tecla del jugador (o espera sin nada pendiente). Lo renueva mark_activity con p_actividad.';
comment on column public.match_players.pendiente_desde is
  'Desde cuándo la pantalla del jugador espera algo suyo (lo declara su móvil con mark_activity); null si nada.';

create function private.cfg_segundos_inactividad() returns integer language sql immutable set search_path = '' as $$ select 60 $$;
create function private.cfg_segundos_bloqueo() returns integer language sql immutable set search_path = '' as $$ select 180 $$;

create function public.mark_activity(p_match uuid, p_pendiente boolean default null, p_actividad boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise();
begin
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  update public.match_players
     set last_heartbeat = now(), connected = true,
         ultima_actividad_at = case when coalesce(p_actividad, true) then now() else ultima_actividad_at end,
         pendiente_desde = case when p_pendiente is true then coalesce(pendiente_desde, now())
                                when p_pendiente is false then null
                                else pendiente_desde end
   where match_id = p_match and user_id = v_me and not forfeited;
  perform private.advance_match(p_match);   -- como heartbeat: solo cierra una pregunta con el plazo vencido
end $$;

create function public.claim_inactivity(p_match uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match); v_act timestamptz; v_pend timestamptz; v_preg timestamptz;
begin
  if p_user = v_me then raise exception 'Para abandonar usa leave_match'; end if;
  perform private.advance_match(p_match);
  select greatest(mp.ultima_actividad_at, m.started_at), mp.pendiente_desde into v_act, v_pend
    from public.match_players mp join public.matches m on m.id = mp.match_id
   where mp.match_id = p_match and mp.user_id = p_user and not mp.forfeited;
  if not found then raise exception 'Ese jugador no sigue en la partida'; end if;
  -- una pregunta suya abierta y en plazo también es una acción pendiente (desde que se repartió)
  select mq.dealt_at into v_preg from public.match_questions mq join public.matches m on m.id = mq.match_id
   where mq.match_id = p_match and mq.question_index = m.current_index and mq.player_id = p_user
     and mq.closed_at is null and mq.closes_at > now();
  v_pend := coalesce(v_pend, v_preg);
  if v_pend is not null then
    if greatest(v_act, v_pend) > now() - make_interval(secs => private.cfg_segundos_inactividad()) then
      raise exception 'Ese jugador sigue activo';
    end if;
  elsif v_act > now() - make_interval(secs => private.cfg_segundos_bloqueo()) then
    raise exception 'Ese jugador no tiene ninguna acción pendiente';
  end if;
  perform private.forfeit(p_match, p_user);
end $$;

revoke execute on function private.cfg_segundos_inactividad(), private.cfg_segundos_bloqueo() from public, anon, authenticated;
revoke execute on function public.mark_activity(uuid, boolean, boolean), public.claim_inactivity(uuid, uuid) from public, anon;
grant execute on function public.mark_activity(uuid, boolean, boolean), public.claim_inactivity(uuid, uuid) to authenticated;
