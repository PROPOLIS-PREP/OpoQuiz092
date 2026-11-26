-- Revancha en las partidas online (3c): «Otra partida» en la pantalla final.
--
-- · match_rematch_requests: una fila por jugador que pide la revancha de una partida terminada (pedida_at).
--   Una petición vale 2 minutos (cfg_segundos_revancha).
-- · matches.rematch_of: la partida anterior de la que nace una revancha. Índice único: como mucho una revancha
--   por partida, aunque las dos peticiones lleguen a la vez.
-- · request_rematch(match):
--     a) solo un jugador de esa partida, con la partida terminada (completed, forfeit o disputed) y de 2 jugadores;
--     b) anota (o renueva) su petición; si el rival la pidió hace menos de 2 minutos, crea la partida nueva con los
--        mismos jugadores, los mismos asientos, el mismo anfitrión, modo y turnos, y la empieza (en curso, con
--        semilla y jugada «inicio», como start_match): los dos móviles entran directamente;
--     c) si no, devuelve «esperando» y los segundos que le quedan a la petición;
--     d) si la revancha ya existe, devuelve esa misma (llamarla otra vez no crea otra).
--   Antes de crear la nueva comprueba el máximo de 3 partidas activas (sala de espera de menos de 30 minutos o en
--   curso, sin contar aquellas en las que el jugador ya abandonó) de cada jugador.
--   No da puntos, monedas ni logros.
-- La primera petición bloquea la fila de la partida anterior (for update): dos peticiones simultáneas se atienden
-- una detrás de otra, y la segunda ve la primera.
-- No es destructiva: añade una columna con valor nulo, una tabla y funciones nuevas.

alter table public.matches add column rematch_of uuid references public.matches (id) on delete set null;
create unique index matches_rematch_of_unico on public.matches (rematch_of) where rematch_of is not null;
comment on column public.matches.rematch_of is 'Partida anterior de la que nace esta revancha (request_rematch); null si no es revancha.';

create table public.match_rematch_requests (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pedida_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index match_rematch_requests_user_idx on public.match_rematch_requests (user_id);
comment on table public.match_rematch_requests is 'Peticiones de revancha (request_rematch). Valen 2 minutos desde pedida_at.';

revoke all on public.match_rematch_requests from anon, authenticated;
grant select on public.match_rematch_requests to authenticated;
alter table public.match_rematch_requests enable row level security;
create policy "match_rematch_requests: solo jugadores de la partida" on public.match_rematch_requests
  for select to authenticated using (private.is_match_player(match_id));

create function private.cfg_segundos_revancha() returns integer language sql immutable set search_path = '' as $$ select 120 $$;
create function private.cfg_max_partidas() returns integer language sql immutable set search_path = '' as $$ select 3 $$;

-- Partidas activas de un jugador: sala de espera de menos de 30 minutos o en curso, sin las que ya abandonó.
-- (Mismo criterio que la app en online/partidas.js.)
create function private.active_matches(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.matches m join public.match_players mp on mp.match_id = m.id
   where mp.user_id = p_user and not mp.forfeited
     and (m.status = 'in_progress' or (m.status = 'lobby' and m.created_at > now() - interval '30 minutes'));
$$;

create function public.request_rematch(p_match uuid)
returns table (estado text, match_id uuid, code text, segundos integer)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches; v_rival uuid; v_nueva uuid; v_code text; v_seed bigint;
        v_pedida timestamptz; abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not exists (select 1 from public.match_players mp where mp.match_id = p_match and mp.user_id = v_me) then
    raise exception 'No jugaste esa partida';
  end if;
  if m.status <> 'finished' then raise exception 'La partida aún no ha terminado'; end if;
  if (select count(*) from public.match_players mp where mp.match_id = p_match) <> 2 then
    raise exception 'La revancha solo es para partidas de dos jugadores';
  end if;

  -- ya creada (la pidió también el rival): la misma, sin crear otra
  select mm.id, mm.code into v_nueva, v_code from public.matches mm where mm.rematch_of = p_match;
  if found then return query select 'creada'::text, v_nueva, v_code, 0; return; end if;

  if private.active_matches(v_me) >= private.cfg_max_partidas() then
    raise exception 'Ya tienes % partidas a la vez: sal de alguna para jugar la revancha', private.cfg_max_partidas();
  end if;

  insert into public.match_rematch_requests (match_id, user_id, pedida_at) values (p_match, v_me, now())
  on conflict on constraint match_rematch_requests_pkey do update set pedida_at = excluded.pedida_at;

  select mp.user_id into v_rival from public.match_players mp where mp.match_id = p_match and mp.user_id <> v_me;
  select r.pedida_at into v_pedida from public.match_rematch_requests r where r.match_id = p_match and r.user_id = v_rival;
  if v_pedida is null or v_pedida <= now() - make_interval(secs => private.cfg_segundos_revancha()) then
    return query select 'esperando'::text, null::uuid, null::text, private.cfg_segundos_revancha();
    return;
  end if;

  if private.active_matches(v_rival) >= private.cfg_max_partidas() then
    raise exception 'Tu rival ya tiene % partidas a la vez: no se puede crear la revancha', private.cfg_max_partidas();
  end if;

  -- la revancha: mismos jugadores y asientos, mismo anfitrión, modo y turnos; empieza ya (como start_match)
  loop
    select string_agg(substr(abc, 1 + floor(random() * length(abc))::integer, 1), '') into v_code from generate_series(1, 5);
    exit when not exists (select 1 from public.matches mm where mm.code = v_code);
  end loop;
  v_seed := floor(random() * 9007199254740991)::bigint;
  insert into public.matches (code, host_id, status, mode, max_players, turns, seed, started_at, rematch_of)
  values (v_code, coalesce(m.host_id, v_me), 'in_progress', m.mode, 2, m.turns, v_seed, now(), p_match)
  returning id into v_nueva;
  insert into public.match_players (match_id, user_id, seat)
  select v_nueva, mp.user_id, mp.seat from public.match_players mp where mp.match_id = p_match;
  perform private.append_action(v_nueva, null, 'inicio', jsonb_build_object(
    'seed', v_seed, 'mode', m.mode, 'turns', m.turns,
    'players', (select jsonb_agg(mp.user_id order by mp.seat) from public.match_players mp where mp.match_id = v_nueva)));
  delete from public.match_rematch_requests r where r.match_id = p_match;
  return query select 'creada'::text, v_nueva, v_code, 0;
end $$;

revoke execute on function private.cfg_segundos_revancha(), private.cfg_max_partidas(), private.active_matches(uuid)
  from public, anon, authenticated;
revoke execute on function public.request_rematch(uuid) from public, anon;
grant execute on function public.request_rematch(uuid) to authenticated;
