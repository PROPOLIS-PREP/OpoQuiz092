-- Patrullan2 v2 · backend online mínimo: cuentas, amigos, grupos y partidas.
-- Proyecto: patrullan2-dev. Documentación: docs/backend-v2.md.
--
-- Principios:
--   · RLS activo en todas las tablas; ninguna política abierta.
--   · Los clientes (rol authenticated) solo leen lo que les toca y escriben a través de las funciones RPC.
--     Excepciones: cada usuario edita columnas concretas de su perfil y puede insertar su propia respuesta.
--   · anon no tiene acceso a nada.
--   · questions y match_questions no son legibles desde el cliente: la respuesta correcta solo sale
--     de get_question_result y submit_answer, cuando la pregunta ya está cerrada.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;  -- las políticas llaman a funciones de private
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- ═══════════════════════════════════════════════════════════════ TABLAS

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null
    constraint profiles_username_formato check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  username_provisional boolean not null default true,
  display_name text not null
    constraint profiles_display_name_largo check (char_length(btrim(display_name)) between 1 and 40),
  avatar_url text
    constraint profiles_avatar_url_largo check (avatar_url is null or char_length(avatar_url) <= 500),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index profiles_username_unico on public.profiles (lower(username));
comment on column public.profiles.username_provisional is
  'true mientras el usuario conserve el nombre generado al registrarse; pasa a false al cambiarlo.';

create table public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    constraint friendships_status check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  constraint friendships_sin_uno_mismo check (requester_id <> addressee_id)
);
-- un único registro por par, sea cual sea el orden
create unique index friendships_par_unico
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester_idx on public.friendships (requester_id);
create index friendships_addressee_idx on public.friendships (addressee_id);
comment on column public.friendships.requester_id is
  'Quien envió la solicitud. En las filas blocked, quien bloquea.';

create table public.groups (
  id bigint generated always as identity primary key,
  name text not null constraint groups_name_largo check (char_length(btrim(name)) between 1 and 40),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index groups_owner_idx on public.groups (owner_id);

create table public.group_members (
  group_id bigint not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' constraint group_members_role check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.questions (
  id text primary key,
  bloque text not null,
  tema integer,
  nivel smallint not null constraint questions_nivel check (nivel between 1 and 7),
  texto text not null,
  opciones jsonb not null
    constraint questions_opciones check (jsonb_typeof(opciones) = 'array' and jsonb_array_length(opciones) between 3 and 4),
  respuesta_correcta smallint not null,
  explicacion text,
  constraint questions_respuesta check (respuesta_correcta >= 0 and respuesta_correcta < jsonb_array_length(opciones))
);
create index questions_nivel_bloque_idx on public.questions (nivel, bloque);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  -- 5 caracteres sin ambiguos: fuera I, L, O, 0 y 1
  code text not null unique constraint matches_code check (code ~ '^[A-HJKMNP-Z2-9]{5}$'),
  host_id uuid references public.profiles (id) on delete set null,
  status text not null default 'lobby' constraint matches_status check (status in ('lobby', 'in_progress', 'finished')),
  mode text not null constraint matches_mode check (mode in ('points', 'ladder')),
  max_players smallint not null constraint matches_max_players check (max_players between 2 and 5),
  turns smallint not null constraint matches_turns check (turns between 1 and 30),
  total_questions integer,          -- turns × jugadores, fijado al empezar
  current_index integer,            -- pregunta en juego; null en el lobby
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index matches_host_idx on public.matches (host_id);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null,                   -- orden de entrada: marca el orden de los turnos
  score integer not null default 0,
  categoria smallint not null default 0 constraint match_players_categoria check (categoria between 0 and 6),
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  constraint match_players_seat_unico unique (match_id, seat)
);
create index match_players_user_idx on public.match_players (user_id);
comment on column public.match_players.categoria is
  '0 Policía … 6 Comisario Principal. En modo ladder fija el nivel de la pregunta de turno.';

create table public.match_questions (
  match_id uuid not null references public.matches (id) on delete cascade,
  question_index integer not null constraint match_questions_index check (question_index >= 0),
  question_id text not null references public.questions (id),
  player_id uuid references public.profiles (id) on delete set null,   -- jugador activo
  nivel smallint not null,
  dealt_at timestamptz not null default now(),
  opened_at timestamptz,            -- cuando el jugador activo la ve por primera vez
  closes_at timestamptz not null,   -- plazo para abrirla y, una vez abierta, para responder
  closed_at timestamptz,
  result text constraint match_questions_result check (result in ('correct', 'wrong', 'timeout')),
  primary key (match_id, question_index)
);
create index match_questions_question_idx on public.match_questions (question_id);
create index match_questions_player_idx on public.match_questions (player_id);

create table public.match_answers (
  match_id uuid not null,
  question_index integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  option_chosen smallint not null constraint match_answers_option check (option_chosen between 0 and 3),
  correct boolean,
  points integer not null default 0,
  answered_at timestamptz not null default now(),
  primary key (match_id, question_index),   -- una sola respuesta por pregunta: la del jugador activo
  foreign key (match_id, question_index)
    references public.match_questions (match_id, question_index) on delete cascade
);
create index match_answers_user_idx on public.match_answers (user_id);

-- ═══════════════════════════════════════════════════════════════ PERMISOS DE TABLA

revoke all on public.profiles, public.friendships, public.groups, public.group_members, public.questions,
  public.matches, public.match_players, public.match_questions, public.match_answers from anon, authenticated;

grant select (id, username, display_name, avatar_url, last_seen_at) on public.profiles to authenticated;
grant update (username, display_name, avatar_url, last_seen_at) on public.profiles to authenticated;
grant select on public.friendships, public.groups, public.group_members,
  public.matches, public.match_players, public.match_answers to authenticated;
grant insert (match_id, question_index, user_id, option_chosen) on public.match_answers to authenticated;
-- questions y match_questions: ningún permiso para anon ni authenticated.

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.questions enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_questions enable row level security;
alter table public.match_answers enable row level security;

-- ═══════════════════════════════════════════════════════════════ FUNCIONES AUXILIARES (private)
-- security definer para que las políticas no se llamen a sí mismas (recursión) al consultar membresías.

create function private.is_group_member(p_group bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = (select auth.uid()));
$$;

create function private.is_group_admin(p_group bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members
                 where group_id = p_group and user_id = (select auth.uid()) and role = 'admin');
$$;

create function private.is_match_player(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.match_players where match_id = p_match and user_id = (select auth.uid()));
$$;

-- ¿Puede el usuario actual responder ahora a esta pregunta?
create function private.can_answer(p_match uuid, p_index integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.matches m
    join public.match_questions q on q.match_id = m.id and q.question_index = p_index
    where m.id = p_match and m.status = 'in_progress' and m.current_index = p_index
      and q.player_id = (select auth.uid()) and q.closed_at is null and q.closes_at > now());
$$;

create function private.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
                 where least(requester_id, addressee_id) = least(a, b)
                   and greatest(requester_id, addressee_id) = greatest(a, b)
                   and status = 'blocked');
$$;

create function private.uid_or_raise() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'Necesitas iniciar sesión' using errcode = '42501'; end if;
  return v;
end $$;

grant execute on function private.is_group_member(bigint), private.is_group_admin(bigint),
  private.is_match_player(uuid), private.can_answer(uuid, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════ POLÍTICAS

create policy "profiles: lectura de campos públicos" on public.profiles
  for select to authenticated using (true);           -- las columnas visibles las limita el grant
create policy "profiles: cada uno edita el suyo" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "friendships: solo sus participantes" on public.friendships
  for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

create policy "groups: solo miembros" on public.groups
  for select to authenticated using (private.is_group_member(id));
create policy "group_members: solo miembros del grupo" on public.group_members
  for select to authenticated using (private.is_group_member(group_id));

create policy "matches: solo sus jugadores" on public.matches
  for select to authenticated using (private.is_match_player(id));
create policy "match_players: solo jugadores de la partida" on public.match_players
  for select to authenticated using (private.is_match_player(match_id));

create policy "match_answers: lectura para jugadores de la partida" on public.match_answers
  for select to authenticated using (private.is_match_player(match_id));
create policy "match_answers: solo la propia y con la partida en curso" on public.match_answers
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_answer(match_id, question_index));

-- questions y match_questions: RLS activo y sin políticas → nadie las lee desde el cliente.

-- ═══════════════════════════════════════════════════════════════ PERFILES

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user text; v_nombre text;
begin
  loop
    v_user := 'agente_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    exit when not exists (select 1 from public.profiles where lower(username) = v_user);
  end loop;
  v_nombre := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
                            nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'Agente'), 40);
  insert into public.profiles (id, username, display_name) values (new.id, v_user, v_nombre);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.profiles_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.username is distinct from old.username then new.username_provisional := false; end if;
  return new;
end $$;

create trigger profiles_before_update before update on public.profiles
  for each row execute function private.profiles_before_update();

-- El propio perfil completo (incluye username_provisional y created_at, que no son públicos).
create function public.my_profile() returns setof public.profiles
language sql stable security definer set search_path = '' as $$
  select * from public.profiles where id = (select auth.uid());
$$;

-- ═══════════════════════════════════════════════════════════════ AMIGOS

create function public.send_friend_request(p_username text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); v_otro uuid; v_id bigint; f public.friendships;
begin
  select id into v_otro from public.profiles where lower(username) = lower(btrim(p_username));
  if v_otro is null then raise exception 'No existe ese usuario'; end if;
  if v_otro = v_me then raise exception 'No puedes enviarte una solicitud a ti mismo'; end if;
  select * into f from public.friendships
   where least(requester_id, addressee_id) = least(v_me, v_otro)
     and greatest(requester_id, addressee_id) = greatest(v_me, v_otro) for update;
  if found then
    if f.status = 'blocked' then raise exception 'No se puede enviar la solicitud'; end if;
    if f.status = 'accepted' then raise exception 'Ya sois amigos'; end if;
    if f.requester_id = v_me then raise exception 'Ya le enviaste una solicitud'; end if;
    -- el otro ya me la había enviado: se acepta
    update public.friendships set status = 'accepted' where id = f.id;
    return f.id;
  end if;
  insert into public.friendships (requester_id, addressee_id) values (v_me, v_otro) returning id into v_id;
  return v_id;
end $$;

create function public.respond_friend_request(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise();
begin
  if not exists (select 1 from public.friendships where id = p_id and addressee_id = v_me and status = 'pending') then
    raise exception 'No hay ninguna solicitud pendiente para ti con ese id';
  end if;
  if p_accept then update public.friendships set status = 'accepted' where id = p_id;
  else delete from public.friendships where id = p_id; end if;   -- rechazar = borrar la solicitud
end $$;

-- Quita un amigo, cancela una solicitud enviada o recibida, o desbloquea (solo quien bloqueó).
create function public.remove_friend(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); f public.friendships;
begin
  select * into f from public.friendships where id = p_id and v_me in (requester_id, addressee_id);
  if not found then raise exception 'No existe esa relación'; end if;
  if f.status = 'blocked' and f.requester_id <> v_me then raise exception 'No existe esa relación'; end if;
  delete from public.friendships where id = p_id;
end $$;

create function public.block_user(p_user uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); v_id bigint;
begin
  if p_user = v_me then raise exception 'No puedes bloquearte a ti mismo'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'No existe ese usuario'; end if;
  delete from public.friendships
   where least(requester_id, addressee_id) = least(v_me, p_user)
     and greatest(requester_id, addressee_id) = greatest(v_me, p_user);
  insert into public.friendships (requester_id, addressee_id, status) values (v_me, p_user, 'blocked')
  returning id into v_id;
  return v_id;
end $$;

-- ═══════════════════════════════════════════════════════════════ GRUPOS

create function public.create_group(p_name text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); v_id bigint;
begin
  insert into public.groups (name, owner_id) values (btrim(p_name), v_me) returning id into v_id;
  insert into public.group_members (group_id, user_id, role) values (v_id, v_me, 'admin');
  return v_id;
end $$;

create function public.invite_to_group(p_group bigint, p_username text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); v_otro uuid;
begin
  if not private.is_group_admin(p_group) then raise exception 'Solo los administradores pueden añadir miembros'; end if;
  select id into v_otro from public.profiles where lower(username) = lower(btrim(p_username));
  if v_otro is null then raise exception 'No existe ese usuario'; end if;
  if private.blocked_between(v_me, v_otro) then raise exception 'No se puede añadir a ese usuario'; end if;
  if exists (select 1 from public.group_members where group_id = p_group and user_id = v_otro) then
    raise exception 'Ya es miembro del grupo';
  end if;
  insert into public.group_members (group_id, user_id) values (p_group, v_otro);
  return v_otro;
end $$;

-- Salida de un grupo. Si sale el propietario, pasa a serlo el administrador más antiguo
-- (o, si no hay, el miembro más antiguo, que se hace administrador). Si no queda nadie, el grupo se borra.
create function private.leave_group_for(p_group bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_nuevo uuid;
begin
  select owner_id into v_owner from public.groups where id = p_group for update;
  if not found then raise exception 'No existe ese grupo'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  if not found then raise exception 'No eres miembro de ese grupo'; end if;
  if v_owner = p_user then
    select user_id into v_nuevo from public.group_members where group_id = p_group
     order by (role = 'admin') desc, joined_at limit 1;
    if v_nuevo is null then delete from public.groups where id = p_group; return; end if;
    update public.groups set owner_id = v_nuevo where id = p_group;
    update public.group_members set role = 'admin' where group_id = p_group and user_id = v_nuevo;
  end if;
end $$;

create function public.leave_group(p_group bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.leave_group_for(p_group, private.uid_or_raise());
end $$;

create function public.remove_group_member(p_group bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise();
begin
  if not private.is_group_admin(p_group) then raise exception 'Solo los administradores pueden quitar miembros'; end if;
  if p_user = v_me then raise exception 'Para salir del grupo usa leave_group'; end if;
  if exists (select 1 from public.groups where id = p_group and owner_id = p_user) then
    raise exception 'No se puede quitar al propietario del grupo';
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  if not found then raise exception 'Ese usuario no es miembro del grupo'; end if;
end $$;

-- ═══════════════════════════════════════════════════════════════ PARTIDAS · reparto de preguntas

-- Tiempos (segundos): para responder desde que el jugador activo ve la pregunta, y para que la abra
-- (cubre el panel de revisión de la pregunta anterior, que se cierra solo a los 10 s).
create function private.cfg_segundos_respuesta() returns integer language sql immutable as $$ select 25 $$;
create function private.cfg_segundos_apertura() returns integer language sql immutable as $$ select 15 $$;

-- Nivel de la pregunta de turno. points: aleatorio 1-7. ladder: según la categoría del jugador,
-- con los mismos pesos que la v1 (PESOS_NIVEL): cuanto más alta la categoría, más preguntas difíciles.
create function private.pick_level(p_mode text, p_categoria smallint) returns smallint
language plpgsql volatile set search_path = '' as $$
declare w integer[]; r double precision; i integer;
begin
  if p_mode = 'points' then return (1 + floor(random() * 7))::smallint; end if;
  w := case p_categoria
         when 0 then array[40,25,15,9,6,3,2]   when 1 then array[25,30,20,12,7,4,2]
         when 2 then array[15,22,26,18,10,6,3] when 3 then array[9,14,20,24,17,10,6]
         when 4 then array[6,9,14,20,24,17,10] when 5 then array[4,6,9,14,20,26,21]
         else array[3,4,6,10,15,24,38] end;
  r := random() * (select sum(x) from unnest(w) x);
  for i in 1..7 loop
    r := r - w[i];
    if r < 0 then return i::smallint; end if;
  end loop;
  return 7;
end $$;

-- Una pregunta no usada en la partida: primero se sortea el bloque (como la ruleta) y luego la pregunta.
create function private.pick_question(p_match uuid, p_nivel smallint) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_id text;
begin
  select q.id into v_id from public.questions q
   where q.nivel = p_nivel
     and q.bloque = (select bloque from public.questions where nivel = p_nivel group by bloque order by random() limit 1)
     and not exists (select 1 from public.match_questions mq where mq.match_id = p_match and mq.question_id = q.id)
   order by random() limit 1;
  if v_id is null then   -- bloque agotado a ese nivel: cualquier pregunta no usada del nivel, o de cualquier nivel
    select q.id into v_id from public.questions q
     where not exists (select 1 from public.match_questions mq where mq.match_id = p_match and mq.question_id = q.id)
     order by (q.nivel = p_nivel) desc, random() limit 1;
  end if;
  if v_id is null then raise exception 'No quedan preguntas disponibles'; end if;
  return v_id;
end $$;

-- Reparte la siguiente pregunta, o termina la partida si ya se jugaron todas. Llamar con la partida bloqueada.
create function private.deal_next(p_match uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.matches; v_idx integer; v_n integer; p public.match_players; v_nivel smallint; v_q text;
begin
  select * into m from public.matches where id = p_match;
  v_idx := coalesce(m.current_index, -1) + 1;
  select count(*) into v_n from public.match_players where match_id = p_match;
  if v_idx >= m.total_questions or v_n = 0 then
    update public.matches set status = 'finished', finished_at = now() where id = p_match;
    return;
  end if;
  select * into p from public.match_players where match_id = p_match
   order by seat offset (v_idx % v_n) limit 1;
  v_nivel := private.pick_level(m.mode, p.categoria);
  v_q := private.pick_question(p_match, v_nivel);
  insert into public.match_questions (match_id, question_index, question_id, player_id, nivel, closes_at)
  values (p_match, v_idx, v_q, p.user_id,
          (select nivel from public.questions where id = v_q),
          now() + make_interval(secs => private.cfg_segundos_apertura()));
  update public.matches set current_index = v_idx where id = p_match;
end $$;

-- Cierra por tiempo la pregunta en juego si venció el plazo (cuenta como fallo) y reparte la siguiente.
-- No hay temporizador en el servidor: se llama desde las RPC de partida cada vez que alguien consulta o responde.
create function private.advance_match(p_match uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  while m.status = 'in_progress' and exists (
          select 1 from public.match_questions
           where match_id = p_match and question_index = m.current_index
             and closed_at is null and closes_at <= now()) loop
    update public.match_questions set closed_at = now(), result = 'timeout'
     where match_id = p_match and question_index = m.current_index;
    perform private.deal_next(p_match);
    select * into m from public.matches where id = p_match;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════ PARTIDAS · RPC

create function public.create_match(p_mode text, p_max_players integer, p_turns integer)
returns table (match_id uuid, code text)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); v_code text; v_id uuid;
        abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if p_mode not in ('points', 'ladder') then raise exception 'Modo no válido: points o ladder'; end if;
  if p_max_players not between 2 and 5 then raise exception 'Entre 2 y 5 jugadores'; end if;
  if p_turns not between 1 and 30 then raise exception 'Entre 1 y 30 turnos'; end if;
  loop
    select string_agg(substr(abc, 1 + floor(random() * length(abc))::integer, 1), '') into v_code
      from generate_series(1, 5);
    exit when not exists (select 1 from public.matches m where m.code = v_code);
  end loop;
  insert into public.matches (code, host_id, mode, max_players, turns)
  values (v_code, v_me, p_mode, p_max_players, p_turns) returning id into v_id;
  insert into public.match_players (match_id, user_id, seat) values (v_id, v_me, 0);
  return query select v_id, v_code;
end $$;

create function public.join_match(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches;
begin
  select * into m from public.matches where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'No existe ninguna partida con ese código'; end if;
  if exists (select 1 from public.match_players where match_id = m.id and user_id = v_me) then return m.id; end if;
  if m.status <> 'lobby' then raise exception 'La partida ya ha empezado'; end if;
  if (select count(*) from public.match_players where match_id = m.id) >= m.max_players then
    raise exception 'La partida está completa';
  end if;
  insert into public.match_players (match_id, user_id, seat)
  values (m.id, v_me, (select coalesce(max(seat), -1) + 1 from public.match_players where match_id = m.id));
  return m.id;
end $$;

-- Salir de una partida que aún está en el lobby. Si sale el anfitrión, lo pasa a ser el siguiente
-- jugador; si no queda nadie, la partida se borra.
create function public.leave_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches; v_nuevo uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not exists (select 1 from public.match_players where match_id = p_match and user_id = v_me) then
    raise exception 'No estás en esa partida';
  end if;
  if m.status <> 'lobby' then raise exception 'Solo se puede salir de una partida que no ha empezado'; end if;
  delete from public.match_players where match_id = p_match and user_id = v_me;
  if m.host_id = v_me then
    select user_id into v_nuevo from public.match_players where match_id = p_match order by seat limit 1;
    if v_nuevo is null then delete from public.matches where id = p_match;
    else update public.matches set host_id = v_nuevo where id = p_match; end if;
  end if;
end $$;

create function public.start_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches; v_n integer;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.host_id is distinct from v_me then raise exception 'Solo el anfitrión puede empezar la partida'; end if;
  if m.status <> 'lobby' then raise exception 'La partida ya ha empezado'; end if;
  select count(*) into v_n from public.match_players where match_id = p_match;
  if v_n < 2 then raise exception 'Hacen falta al menos 2 jugadores'; end if;
  update public.matches set status = 'in_progress', started_at = now(), total_questions = m.turns * v_n
   where id = p_match;
  perform private.deal_next(p_match);
end $$;

-- Pregunta en juego, sin la respuesta correcta. Si quien la pide es el jugador activo y aún no la había
-- abierto, empiezan a contar sus 25 segundos.
create function public.get_current_question(p_match uuid)
returns table (question_index integer, player_id uuid, bloque text, nivel smallint, texto text,
               opciones jsonb, opened boolean, closes_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches;
begin
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  perform private.advance_match(p_match);
  select * into m from public.matches where id = p_match;
  if m.status <> 'in_progress' then return; end if;
  update public.match_questions mq
     set opened_at = now(), closes_at = now() + make_interval(secs => private.cfg_segundos_respuesta())
   where mq.match_id = p_match and mq.question_index = m.current_index
     and mq.player_id = v_me and mq.opened_at is null and mq.closed_at is null;
  return query
    select mq.question_index, mq.player_id, q.bloque, mq.nivel, q.texto, q.opciones,
           mq.opened_at is not null, mq.closes_at
      from public.match_questions mq join public.questions q on q.id = mq.question_id
     where mq.match_id = p_match and mq.question_index = m.current_index;
end $$;

-- Resultado de una pregunta ya cerrada: aquí se revela la respuesta correcta.
create function public.get_question_result(p_match uuid, p_index integer)
returns table (question_index integer, player_id uuid, result text, option_chosen smallint,
               respuesta_correcta smallint, explicacion text, points integer)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.uid_or_raise();
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  perform private.advance_match(p_match);
  return query
    select mq.question_index, mq.player_id, mq.result, a.option_chosen, q.respuesta_correcta, q.explicacion,
           coalesce(a.points, 0)
      from public.match_questions mq
      join public.questions q on q.id = mq.question_id
      left join public.match_answers a on a.match_id = mq.match_id and a.question_index = mq.question_index
     where mq.match_id = p_match and mq.question_index = p_index and mq.closed_at is not null;
end $$;

-- Validación y puntuación de una respuesta. Se ejecuta en triggers para que el resultado sea el mismo
-- tanto si se responde con submit_answer como con un insert directo en match_answers.
create function private.match_answers_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.matches; mq public.match_questions; v_ok smallint;
begin
  if new.user_id is distinct from (select auth.uid()) then
    raise exception 'Solo puedes responder por ti' using errcode = '42501';
  end if;
  select * into m from public.matches where id = new.match_id for update;
  if not found or m.status <> 'in_progress' then raise exception 'La partida no está en curso'; end if;
  if new.question_index is distinct from m.current_index then raise exception 'Esa no es la pregunta en juego'; end if;
  select * into mq from public.match_questions where match_id = new.match_id and question_index = new.question_index;
  if mq.player_id is distinct from new.user_id then raise exception 'No es tu turno'; end if;
  if mq.closed_at is not null or mq.closes_at <= now() then raise exception 'La pregunta ya está cerrada'; end if;
  select respuesta_correcta into v_ok from public.questions where id = mq.question_id;
  new.correct := new.option_chosen = v_ok;
  new.points := case when new.correct then mq.nivel else 0 end;   -- un acierto vale tantos puntos como su nivel
  new.answered_at := now();
  return new;
end $$;

create function private.match_answers_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.match_questions set closed_at = now(), result = case when new.correct then 'correct' else 'wrong' end
   where match_id = new.match_id and question_index = new.question_index;
  update public.match_players set score = score + new.points
   where match_id = new.match_id and user_id = new.user_id;
  perform private.deal_next(new.match_id);
  return null;
end $$;

create trigger match_answers_before_insert before insert on public.match_answers
  for each row execute function private.match_answers_before_insert();
create trigger match_answers_after_insert after insert on public.match_answers
  for each row execute function private.match_answers_after_insert();

create function public.submit_answer(p_match uuid, p_index integer, p_option integer)
returns table (correct boolean, points integer, respuesta_correcta smallint, explicacion text, score integer)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise();
begin
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  perform private.advance_match(p_match);   -- si el plazo venció, la pregunta se cierra como fallo
  insert into public.match_answers (match_id, question_index, user_id, option_chosen)
  values (p_match, p_index, v_me, p_option);
  return query
    select a.correct, a.points, q.respuesta_correcta, q.explicacion, mp.score
      from public.match_answers a
      join public.match_questions mq on mq.match_id = a.match_id and mq.question_index = a.question_index
      join public.questions q on q.id = mq.question_id
      join public.match_players mp on mp.match_id = a.match_id and mp.user_id = a.user_id
     where a.match_id = p_match and a.question_index = p_index;
end $$;

-- ═══════════════════════════════════════════════════════════════ BORRADO DE CUENTA
-- Lo llama la Edge Function delete_account (service_role) justo antes de borrar el usuario de auth.
-- El resto de datos se borra en cascada al desaparecer auth.users → profiles.
create function public.prepare_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g bigint; m record; v_nuevo uuid;
begin
  for g in select group_id from public.group_members where user_id = p_user loop
    perform private.leave_group_for(g, p_user);
  end loop;
  for m in select id, status from public.matches where host_id = p_user and status <> 'finished' for update loop
    select user_id into v_nuevo from public.match_players
     where match_id = m.id and user_id <> p_user order by seat limit 1;
    if v_nuevo is null then delete from public.matches where id = m.id;
    else update public.matches set host_id = v_nuevo where id = m.id; end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════ PERMISOS DE FUNCIONES

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_group_member(bigint), private.is_group_admin(bigint),
  private.is_match_player(uuid), private.can_answer(uuid, integer) to authenticated;

revoke execute on function
  public.my_profile(), public.send_friend_request(text), public.respond_friend_request(bigint, boolean),
  public.remove_friend(bigint), public.block_user(uuid), public.create_group(text),
  public.invite_to_group(bigint, text), public.leave_group(bigint), public.remove_group_member(bigint, uuid),
  public.create_match(text, integer, integer), public.join_match(text), public.leave_match(uuid),
  public.start_match(uuid), public.get_current_question(uuid), public.get_question_result(uuid, integer),
  public.submit_answer(uuid, integer, integer), public.prepare_account_deletion(uuid)
from public, anon, authenticated;

grant execute on function
  public.my_profile(), public.send_friend_request(text), public.respond_friend_request(bigint, boolean),
  public.remove_friend(bigint), public.block_user(uuid), public.create_group(text),
  public.invite_to_group(bigint, text), public.leave_group(bigint), public.remove_group_member(bigint, uuid),
  public.create_match(text, integer, integer), public.join_match(text), public.leave_match(uuid),
  public.start_match(uuid), public.get_current_question(uuid), public.get_question_result(uuid, integer),
  public.submit_answer(uuid, integer, integer)
to authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════ REALTIME
-- Cambios en vivo para la sala y la partida (Realtime aplica RLS: cada cliente solo recibe lo que puede leer).
alter publication supabase_realtime add table
  public.friendships, public.group_members, public.matches, public.match_players, public.match_answers;
