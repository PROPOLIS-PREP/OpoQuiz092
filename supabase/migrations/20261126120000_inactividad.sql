-- Inactividad en las partidas online (3c): un jugador que no toca la pantalla durante 60 s en su turno pierde.
-- Es distinto del corte de red (claim_forfeit, 60 s sin latido): aquí la pestaña sigue abierta y enviando
-- latidos, pero la persona no hace nada.
--
-- · match_players.ultima_actividad_at: último toque, clic o tecla del jugador (lo envía mark_activity).
--   Mientras le toca al rival, el cliente también lo envía periódicamente: esperar no es estar inactivo.
-- · mark_activity(match): registra la actividad (y cuenta como latido).
-- · claim_inactivity(match, jugador): un rival da por perdida la partida al jugador sin actividad desde hace
--   60 s (contando desde el comienzo de la partida si no ha hecho nada todavía). La valida el servidor.
--   El servidor no sabe de quién es el turno (lo lleva el motor): por eso el cliente que espera envía actividad.
-- No es destructiva: añade una columna con valor por defecto y tres funciones nuevas.

alter table public.match_players add column ultima_actividad_at timestamptz not null default now();
comment on column public.match_players.ultima_actividad_at is
  'Último toque, clic o tecla del jugador en la partida (mark_activity). claim_inactivity lo usa para los 60 s.';

create function private.cfg_segundos_inactividad() returns integer language sql immutable set search_path = '' as $$ select 60 $$;

create function public.mark_activity(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise();
begin
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  update public.match_players set ultima_actividad_at = now(), last_heartbeat = now(), connected = true
   where match_id = p_match and user_id = v_me and not forfeited;
  perform private.advance_match(p_match);
end $$;

create function public.claim_inactivity(p_match uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match); v_ref timestamptz;
begin
  if p_user = v_me then raise exception 'Para abandonar usa leave_match'; end if;
  select greatest(mp.ultima_actividad_at, m.started_at) into v_ref
    from public.match_players mp join public.matches m on m.id = mp.match_id
   where mp.match_id = p_match and mp.user_id = p_user and not mp.forfeited;
  if not found then raise exception 'Ese jugador no sigue en la partida'; end if;
  if v_ref > now() - make_interval(secs => private.cfg_segundos_inactividad()) then
    raise exception 'Ese jugador sigue activo';
  end if;
  perform private.forfeit(p_match, p_user);
end $$;

revoke execute on function private.cfg_segundos_inactividad() from public, anon, authenticated;
revoke execute on function public.mark_activity(uuid), public.claim_inactivity(uuid, uuid) from public, anon;
grant execute on function public.mark_activity(uuid), public.claim_inactivity(uuid, uuid) to authenticated;
