-- Patrullan2 v2 · backend online: cuentas, amigos, grupos y partidas.
-- Proyecto: patrullan2-dev. Documentación: docs/backend-v2.md.
--
-- Modelo de partida («lockstep»): cada móvil ejecuta el mismo motor que el modo local, con la misma semilla
-- de azar, y aplica en el mismo orden las jugadas del registro match_actions. Así todos calculan lo mismo:
-- tablero, fichas, cartas, eventos, méritos, ascensos y puntuación son los del modo local.
-- El servidor se encarga de lo que no puede quedar en el cliente:
--   · la semilla, el orden de las jugadas y el registro (match_actions);
--   · las preguntas: elige una no usada, oculta la respuesta, cuenta el tiempo y valida la respuesta;
--   · los comodines que dependen de la respuesta (50/50) o del reloj (+10 s);
--   · los abandonos (quien abandona pierde) y el resultado final.
--
-- Principios de seguridad:
--   · RLS activo en todas las tablas; ninguna política abierta.
--   · Los clientes (authenticated) solo leen lo que les toca y escriben a través de funciones RPC.
--     Excepciones: cada usuario edita columnas concretas de su perfil y puede insertar su propia respuesta.
--   · anon no tiene acceso a nada.
--   · questions y match_questions no son legibles desde el cliente: la respuesta correcta solo sale de
--     submit_answer y get_question_result, cuando la pregunta ya está cerrada.

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

-- Invitaciones pendientes: un admin invita a un amigo suyo y el invitado acepta o rechaza.
create table public.group_invitations (
  group_id bigint not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_invitations_user_idx on public.group_invitations (user_id);
create index group_invitations_invited_by_idx on public.group_invitations (invited_by);

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
  seed bigint,                      -- semilla del azar del motor; se fija al empezar
  current_index integer,            -- última pregunta repartida; null si aún no hay ninguna
  winner_id uuid references public.profiles (id) on delete set null,
  finish_reason text constraint matches_finish_reason check (finish_reason in ('completed', 'forfeit', 'disputed')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index matches_host_idx on public.matches (host_id);
create index matches_winner_idx on public.matches (winner_id);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null,                   -- orden de entrada: el orden de los jugadores en el motor
  score integer,                            -- puntuación final, la que calcula el motor
  forfeited boolean not null default false, -- abandonó: pierde automáticamente
  last_heartbeat timestamptz not null default now(),
  reported_scores jsonb,                    -- resultado final que envió este jugador
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  constraint match_players_seat_unico unique (match_id, seat)
);
create index match_players_user_idx on public.match_players (user_id);

-- Registro de jugadas. Es la única fuente de verdad del desarrollo de la partida: los motores lo aplican en orden.
create table public.match_actions (
  match_id uuid not null references public.matches (id) on delete cascade,
  seq integer not null constraint match_actions_seq check (seq >= 0),
  user_id uuid references public.profiles (id) on delete set null,   -- null: jugada del servidor
  kind text not null constraint match_actions_kind check (kind ~ '^[a-z_]{1,30}$'),
  payload jsonb not null default '{}'::jsonb
    constraint match_actions_payload check (pg_column_size(payload) <= 4096),
  created_at timestamptz not null default now(),
  primary key (match_id, seq)
);
create index match_actions_user_idx on public.match_actions (user_id);

create table public.match_questions (
  match_id uuid not null references public.matches (id) on delete cascade,
  question_index integer not null constraint match_questions_index check (question_index >= 0),
  question_id text not null references public.questions (id),
  player_id uuid references public.profiles (id) on delete set null,   -- quien debe responder
  tipo text not null constraint match_questions_tipo check (tipo in ('turno', 'casilla', 'examen')),
  bloque text not null,
  nivel smallint not null,
  segundos smallint not null constraint match_questions_segundos check (segundos between 5 and 60),
  dealt_at timestamptz not null default now(),
  opened_at timestamptz,            -- cuando quien responde la ve por primera vez
  closes_at timestamptz not null,   -- plazo para abrirla y, una vez abierta, para responder
  closed_at timestamptz,
  result text constraint match_questions_result check (result in ('correct', 'wrong', 'timeout')),
  descartadas smallint[] not null default '{}',   -- opciones quitadas por un 50/50
  comodines text[] not null default '{}',         -- comodines usados en esta pregunta
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
  answered_at timestamptz not null default now(),
  primary key (match_id, question_index),   -- una sola respuesta por pregunta
  foreign key (match_id, question_index)
    references public.match_questions (match_id, question_index) on delete cascade
);
create index match_answers_user_idx on public.match_answers (user_id);

-- ═══════════════════════════════════════════════════════════════ PERMISOS DE TABLA

revoke all on public.profiles, public.friendships, public.groups, public.group_members, public.group_invitations,
  public.questions, public.matches, public.match_players, public.match_actions, public.match_questions,
  public.match_answers from anon, authenticated;

grant select (id, username, display_name, avatar_url, last_seen_at) on public.profiles to authenticated;
grant update (username, display_name, avatar_url, last_seen_at) on public.profiles to authenticated;
grant select on public.friendships, public.groups, public.group_members, public.group_invitations,
  public.matches, public.match_players, public.match_actions, public.match_answers to authenticated;
grant insert (match_id, question_index, user_id, option_chosen) on public.match_answers to authenticated;
-- questions y match_questions: ningún permiso para anon ni authenticated.

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.questions enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_actions enable row level security;
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

create function private.is_group_invited(p_group bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_invitations where group_id = p_group and user_id = (select auth.uid()));
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
    join public.match_players mp on mp.match_id = m.id and mp.user_id = (select auth.uid())
    where m.id = p_match and m.status = 'in_progress' and m.current_index = p_index and not mp.forfeited
      and q.player_id = (select auth.uid()) and q.closed_at is null and q.closes_at > now());
$$;

create function private.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
                 where least(requester_id, addressee_id) = least(a, b)
                   and greatest(requester_id, addressee_id) = greatest(a, b)
                   and status = 'accepted');
$$;

create function private.uid_or_raise() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'Necesitas iniciar sesión' using errcode = '42501'; end if;
  return v;
end $$;

-- ═══════════════════════════════════════════════════════════════ POLÍTICAS

create policy "profiles: lectura de campos públicos" on public.profiles
  for select to authenticated using (true);           -- las columnas visibles las limita el grant
create policy "profiles: cada uno edita el suyo" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "friendships: solo sus participantes" on public.friendships
  for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

create policy "groups: miembros e invitados" on public.groups
  for select to authenticated using (private.is_group_member(id) or private.is_group_invited(id));
create policy "group_members: solo miembros del grupo" on public.group_members
  for select to authenticated using (private.is_group_member(group_id));
create policy "group_invitations: el invitado y los admins del grupo" on public.group_invitations
  for select to authenticated using (user_id = (select auth.uid()) or private.is_group_admin(group_id));

create policy "matches: solo sus jugadores" on public.matches
  for select to authenticated using (private.is_match_player(id));
create policy "match_players: solo jugadores de la partida" on public.match_players
  for select to authenticated using (private.is_match_player(match_id));
create policy "match_actions: solo jugadores de la partida" on public.match_actions
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

-- ═══════════════════════════════════════════════════════════════ AMIGOS (por mutuo acuerdo)

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
    -- el otro ya me la había enviado: ambos quieren, queda aceptada
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
  -- un bloqueo también anula las invitaciones a grupos entre los dos
  delete from public.group_invitations
   where (user_id = p_user and invited_by = v_me) or (user_id = v_me and invited_by = p_user);
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

-- Un admin invita a un amigo suyo. El invitado entra solo si acepta (respond_group_invitation).
create function public.invite_to_group(p_group bigint, p_username text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); v_otro uuid;
begin
  if not private.is_group_admin(p_group) then raise exception 'Solo los administradores pueden invitar'; end if;
  select id into v_otro from public.profiles where lower(username) = lower(btrim(p_username));
  if v_otro is null then raise exception 'No existe ese usuario'; end if;
  if not private.are_friends(v_me, v_otro) then raise exception 'Solo puedes invitar a tus amigos'; end if;
  if exists (select 1 from public.group_members where group_id = p_group and user_id = v_otro) then
    raise exception 'Ya es miembro del grupo';
  end if;
  insert into public.group_invitations (group_id, user_id, invited_by) values (p_group, v_otro, v_me)
  on conflict (group_id, user_id) do nothing;
  return v_otro;
end $$;

create function public.respond_group_invitation(p_group bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise();
begin
  delete from public.group_invitations where group_id = p_group and user_id = v_me;
  if not found then raise exception 'No tienes ninguna invitación a ese grupo'; end if;
  if p_accept then
    insert into public.group_members (group_id, user_id) values (p_group, v_me) on conflict do nothing;
  end if;
end $$;

-- Un admin retira una invitación pendiente.
create function public.cancel_group_invitation(p_group bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.uid_or_raise();
  if not private.is_group_admin(p_group) then raise exception 'Solo los administradores pueden retirar invitaciones'; end if;
  delete from public.group_invitations where group_id = p_group and user_id = p_user;
  if not found then raise exception 'No hay ninguna invitación para ese usuario'; end if;
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

-- ═══════════════════════════════════════════════════════════════ PARTIDAS · internas

-- Segundos que tiene el jugador para abrir su pregunta desde que se reparte. Si no la abre, cuenta como fallo.
create function private.cfg_segundos_apertura() returns integer language sql immutable as $$ select 10 $$;
-- Segundos sin latido tras los que cualquier rival puede dar por abandonada la partida a un jugador.
create function private.cfg_segundos_abandono() returns integer language sql immutable as $$ select 60 $$;

-- Añade una jugada al registro. Llamar con la partida bloqueada (select … for update).
create function private.append_action(p_match uuid, p_user uuid, p_kind text, p_payload jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_seq integer;
begin
  select coalesce(max(seq), -1) + 1 into v_seq from public.match_actions where match_id = p_match;
  insert into public.match_actions (match_id, seq, user_id, kind, payload)
  values (p_match, v_seq, p_user, p_kind, coalesce(p_payload, '{}'::jsonb));
  return v_seq;
end $$;

-- Cierra la pregunta en juego y anota el resultado en el registro, para que los motores lo apliquen.
create function private.close_question(p_match uuid, p_index integer, p_result text, p_option smallint) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_player uuid;
begin
  update public.match_questions set closed_at = now(), result = p_result
   where match_id = p_match and question_index = p_index and closed_at is null
   returning player_id into v_player;
  if not found then return; end if;
  perform private.append_action(p_match, null, 'resultado', jsonb_build_object(
    'question_index', p_index, 'player', v_player, 'result', p_result, 'option', p_option));
end $$;

-- Cierra por tiempo la pregunta en juego si venció su plazo (cuenta como fallo).
-- No hay temporizador en el servidor: se llama desde las RPC de partida cada vez que alguien consulta o actúa.
create function private.advance_match(p_match uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status = 'in_progress' and m.current_index is not null and exists (
       select 1 from public.match_questions
        where match_id = p_match and question_index = m.current_index and closed_at is null and closes_at <= now()) then
    perform private.close_question(p_match, m.current_index, 'timeout', null);
  end if;
end $$;

-- Termina la partida. Con p_winner fija el ganador; con p_reason 'forfeit' se termina por abandono.
create function private.finish_match(p_match uuid, p_winner uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status = 'finished' then return; end if;
  if m.current_index is not null then perform private.close_question(p_match, m.current_index, 'timeout', null); end if;
  update public.matches set status = 'finished', finished_at = now(), winner_id = p_winner, finish_reason = p_reason
   where id = p_match;
  perform private.append_action(p_match, null, 'fin', jsonb_build_object('winner', p_winner, 'reason', p_reason));
end $$;

-- Un jugador abandona: pierde automáticamente. Si solo queda un rival, gana ese rival y la partida termina.
-- Con más jugadores, la partida sigue y los motores saltan sus turnos.
create function private.forfeit(p_match uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.matches; v_quedan integer; v_ultimo uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status <> 'in_progress' then return; end if;
  update public.match_players set forfeited = true, connected = false
   where match_id = p_match and user_id = p_user and not forfeited;
  if not found then return; end if;
  -- si tenía una pregunta abierta, cuenta como fallo
  if exists (select 1 from public.match_questions where match_id = p_match and question_index = m.current_index
              and player_id = p_user and closed_at is null) then
    perform private.close_question(p_match, m.current_index, 'timeout', null);
  end if;
  perform private.append_action(p_match, null, 'abandono', jsonb_build_object('player', p_user));
  select count(*), min(user_id::text)::uuid into v_quedan, v_ultimo
    from public.match_players where match_id = p_match and not forfeited;
  if v_quedan <= 1 then
    perform private.finish_match(p_match, case when v_quedan = 1 then v_ultimo end, 'forfeit');
  end if;
end $$;

-- Una pregunta no usada en la partida, del bloque y nivel pedidos. Si se agotan, del mismo nivel y luego de cualquiera.
create function private.pick_question(p_match uuid, p_bloque text, p_nivel smallint) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_id text;
begin
  select q.id into v_id from public.questions q
   where q.nivel = p_nivel and q.bloque = p_bloque
     and not exists (select 1 from public.match_questions mq where mq.match_id = p_match and mq.question_id = q.id)
   order by random() limit 1;
  if v_id is null then
    select q.id into v_id from public.questions q
     where not exists (select 1 from public.match_questions mq where mq.match_id = p_match and mq.question_id = q.id)
     order by (q.nivel = p_nivel) desc, (q.bloque = p_bloque) desc, random() limit 1;
  end if;
  if v_id is null then raise exception 'No quedan preguntas disponibles'; end if;
  return v_id;
end $$;

-- Comprueba que el usuario actual juega esta partida, sigue en ella y la partida está en curso. Bloquea la partida.
create function private.lock_active_player(p_match uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches; v_fuera boolean;
begin
  select * into m from public.matches where id = p_match for update;
  select forfeited into v_fuera from public.match_players where match_id = p_match and user_id = v_me;
  if not found or v_fuera is null then raise exception 'No estás en esa partida'; end if;
  if m.status <> 'in_progress' then raise exception 'La partida no está en curso'; end if;
  if v_fuera then raise exception 'Abandonaste esta partida'; end if;
  return v_me;
end $$;

-- ═══════════════════════════════════════════════════════════════ PARTIDAS · sala

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

-- Salir de una partida. En el lobby, simplemente sales (si eras anfitrión, lo pasa a ser el siguiente;
-- si no queda nadie, se borra). En curso, es un abandono: pierdes automáticamente.
create function public.leave_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches; v_nuevo uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not exists (select 1 from public.match_players where match_id = p_match and user_id = v_me) then
    raise exception 'No estás en esa partida';
  end if;
  if m.status = 'in_progress' then perform private.forfeit(p_match, v_me); return; end if;
  if m.status = 'finished' then return; end if;
  delete from public.match_players where match_id = p_match and user_id = v_me;
  if m.host_id = v_me then
    select user_id into v_nuevo from public.match_players where match_id = p_match order by seat limit 1;
    if v_nuevo is null then delete from public.matches where id = p_match;
    else update public.matches set host_id = v_nuevo where id = p_match; end if;
  end if;
end $$;

-- Empieza la partida: fija la semilla del azar y anota en el registro el orden de los jugadores.
create function public.start_match(p_match uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches; v_n integer; v_seed bigint;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.host_id is distinct from v_me then raise exception 'Solo el anfitrión puede empezar la partida'; end if;
  if m.status <> 'lobby' then raise exception 'La partida ya ha empezado'; end if;
  select count(*) into v_n from public.match_players where match_id = p_match;
  if v_n < 2 then raise exception 'Hacen falta al menos 2 jugadores'; end if;
  v_seed := floor(random() * 9007199254740991)::bigint;   -- cabe en un entero seguro de JavaScript
  update public.matches set status = 'in_progress', started_at = now(), seed = v_seed where id = p_match;
  update public.match_players set last_heartbeat = now() where match_id = p_match;
  perform private.append_action(p_match, null, 'inicio', jsonb_build_object(
    'seed', v_seed, 'mode', m.mode, 'turns', m.turns,
    'players', (select jsonb_agg(user_id order by seat) from public.match_players where match_id = p_match)));
  return v_seed;
end $$;

-- Latido: cada cliente lo envía cada ~15 s mientras juega. Sin latido durante 60 s, un rival puede reclamar el abandono.
create function public.heartbeat(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise();
begin
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  update public.match_players set last_heartbeat = now(), connected = true
   where match_id = p_match and user_id = v_me and not forfeited;
  perform private.advance_match(p_match);
end $$;

-- Si un jugador cerró la app o perdió la conexión (60 s sin latido), cualquier rival puede darle por abandonado.
create function public.claim_forfeit(p_match uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match); v_ultimo timestamptz;
begin
  if p_user = v_me then raise exception 'Para abandonar usa leave_match'; end if;
  select last_heartbeat into v_ultimo from public.match_players
   where match_id = p_match and user_id = p_user and not forfeited;
  if not found then raise exception 'Ese jugador no sigue en la partida'; end if;
  if v_ultimo > now() - make_interval(secs => private.cfg_segundos_abandono()) then
    raise exception 'Ese jugador sigue conectado';
  end if;
  perform private.forfeit(p_match, p_user);
end $$;

-- ═══════════════════════════════════════════════════════════════ PARTIDAS · jugadas y preguntas

-- Jugada del motor (tirar el dado, elegir objetivo, desplegar efectivos, presentarse al examen…).
-- p_expected_seq es el número que el cliente espera que tenga: si otro llegó antes, falla y el cliente
-- debe leer las jugadas nuevas, aplicarlas y decidir de nuevo. Los motores descartan las jugadas no válidas.
create function public.submit_action(p_match uuid, p_expected_seq integer, p_kind text, p_payload jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match); v_seq integer;
begin
  if p_kind in ('inicio', 'pregunta', 'resultado', 'comodin', 'abandono', 'fin') then
    raise exception 'Esa jugada la anota el servidor';
  end if;
  select coalesce(max(seq), -1) + 1 into v_seq from public.match_actions where match_id = p_match;
  if p_expected_seq is distinct from v_seq then
    raise exception 'Desincronizado: la siguiente jugada es la %', v_seq using errcode = '40001';
  end if;
  perform private.advance_match(p_match);
  return private.append_action(p_match, v_me, p_kind, p_payload);
end $$;

-- Reparte una pregunta al usuario actual. El motor decide el bloque (ruleta o casilla), el nivel (según categoría
-- y efectos) y los segundos (25 de base, más o menos según radar, examen y cartas); los demás motores lo verifican
-- con la jugada «pregunta» del registro. El servidor elige una pregunta no usada y guarda la respuesta.
create function public.draw_question(p_match uuid, p_bloque text, p_nivel integer, p_segundos integer, p_tipo text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match); m public.matches; v_idx integer; v_q text; v_bloque text;
begin
  if p_nivel not between 1 and 7 then raise exception 'Nivel no válido'; end if;
  if p_segundos not between 5 and 60 then raise exception 'Segundos no válidos'; end if;
  if p_tipo not in ('turno', 'casilla', 'examen') then raise exception 'Tipo de pregunta no válido'; end if;
  perform private.advance_match(p_match);
  select * into m from public.matches where id = p_match;
  if m.current_index is not null and exists (select 1 from public.match_questions
       where match_id = p_match and question_index = m.current_index and closed_at is null) then
    raise exception 'Todavía hay una pregunta abierta';
  end if;
  v_bloque := coalesce(p_bloque, (select bloque from public.questions group by bloque order by random() limit 1));
  v_q := private.pick_question(p_match, v_bloque, p_nivel::smallint);
  v_idx := coalesce(m.current_index, -1) + 1;
  insert into public.match_questions (match_id, question_index, question_id, player_id, tipo, bloque, nivel, segundos, closes_at)
  select p_match, v_idx, q.id, v_me, p_tipo, q.bloque, q.nivel, p_segundos,
         now() + make_interval(secs => private.cfg_segundos_apertura())
    from public.questions q where q.id = v_q;
  update public.matches set current_index = v_idx where id = p_match;
  perform private.append_action(p_match, v_me, 'pregunta', (
    select jsonb_build_object('question_index', v_idx, 'tipo', p_tipo, 'bloque', bloque, 'nivel', nivel,
                              'nivel_pedido', p_nivel, 'segundos', p_segundos)
      from public.match_questions where match_id = p_match and question_index = v_idx));
  return v_idx;
end $$;

-- Pregunta en juego, sin la respuesta. Si la pide quien debe responder y aún no la había abierto,
-- empieza a contar su tiempo (los segundos con que se repartió).
create function public.get_current_question(p_match uuid)
returns table (question_index integer, player_id uuid, tipo text, bloque text, nivel smallint, texto text,
               opciones jsonb, descartadas smallint[], opened boolean, closes_at timestamptz, closed boolean)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.uid_or_raise(); m public.matches;
begin
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  perform private.advance_match(p_match);
  select * into m from public.matches where id = p_match;
  if m.current_index is null then return; end if;
  update public.match_questions mq
     set opened_at = now(), closes_at = now() + make_interval(secs => mq.segundos)
   where mq.match_id = p_match and mq.question_index = m.current_index
     and mq.player_id = v_me and mq.opened_at is null and mq.closed_at is null and m.status = 'in_progress';
  return query
    select mq.question_index, mq.player_id, mq.tipo, mq.bloque, mq.nivel, q.texto, q.opciones, mq.descartadas,
           mq.opened_at is not null, mq.closes_at, mq.closed_at is not null
      from public.match_questions mq join public.questions q on q.id = mq.question_id
     where mq.match_id = p_match and mq.question_index = m.current_index;
end $$;

-- Comodines que necesitan al servidor, en la pregunta abierta del usuario:
--   'mitad'  (comodín 50/50 o carta Chivatazo): quita opciones falsas hasta dejar dos. Devuelve las quitadas.
--   'tiempo' (comodín +10 s): alarga el plazo 10 segundos.
-- El resto de efectos (sirena, multiplicadores…) los aplica el motor. Que el jugador tenga el comodín lo verifican los motores.
create function public.use_lifeline(p_match uuid, p_index integer, p_kind text) returns smallint[]
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match); mq public.match_questions; v_ok smallint; v_n integer;
        v_fuera smallint[];
begin
  if p_kind not in ('mitad', 'tiempo') then raise exception 'Comodín no válido'; end if;
  perform private.advance_match(p_match);
  select * into mq from public.match_questions where match_id = p_match and question_index = p_index for update;
  if not found or mq.player_id is distinct from v_me or mq.closed_at is not null or mq.opened_at is null then
    raise exception 'No tienes esa pregunta abierta';
  end if;
  if p_kind = any (mq.comodines) then raise exception 'Ese comodín ya se usó en esta pregunta'; end if;
  if p_kind = 'mitad' then
    select respuesta_correcta, jsonb_array_length(opciones) into v_ok, v_n from public.questions where id = mq.question_id;
    select coalesce(array_agg(i::smallint), '{}') into v_fuera from (
      select i from generate_series(0, v_n - 1) i where i <> v_ok order by random() limit greatest(v_n - 2, 0)) s;
    update public.match_questions set descartadas = v_fuera, comodines = comodines || p_kind
     where match_id = p_match and question_index = p_index;
  else
    v_fuera := '{}';
    update public.match_questions set closes_at = closes_at + interval '10 seconds', comodines = comodines || p_kind
     where match_id = p_match and question_index = p_index;
  end if;
  perform private.append_action(p_match, v_me, 'comodin',
    jsonb_build_object('question_index', p_index, 'kind', p_kind, 'descartadas', to_jsonb(v_fuera)));
  return v_fuera;
end $$;

-- Validación de una respuesta. Va en triggers para que el resultado sea el mismo tanto con submit_answer
-- como con un insert directo en match_answers.
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
  if mq.player_id is distinct from new.user_id then raise exception 'Esta pregunta no es tuya'; end if;
  if mq.closed_at is not null or mq.closes_at <= now() then raise exception 'La pregunta ya está cerrada'; end if;
  if new.option_chosen = any (mq.descartadas) then raise exception 'Esa opción está descartada'; end if;
  select respuesta_correcta into v_ok from public.questions where id = mq.question_id;
  if new.option_chosen >= (select jsonb_array_length(opciones) from public.questions where id = mq.question_id) then
    raise exception 'Opción no válida';
  end if;
  new.correct := new.option_chosen = v_ok;
  new.answered_at := now();
  return new;
end $$;

create function private.match_answers_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.close_question(new.match_id, new.question_index,
    case when new.correct then 'correct' else 'wrong' end, new.option_chosen);
  return null;
end $$;

create trigger match_answers_before_insert before insert on public.match_answers
  for each row execute function private.match_answers_before_insert();
create trigger match_answers_after_insert after insert on public.match_answers
  for each row execute function private.match_answers_after_insert();

-- Responde a tu pregunta abierta. Devuelve si aciertas, la respuesta correcta y la explicación.
-- La puntuación la calcula el motor, igual que en el modo local.
create function public.submit_answer(p_match uuid, p_index integer, p_option integer)
returns table (correct boolean, respuesta_correcta smallint, explicacion text)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match);
begin
  perform private.advance_match(p_match);   -- si el plazo venció, la pregunta se cierra como fallo
  insert into public.match_answers (match_id, question_index, user_id, option_chosen)
  values (p_match, p_index, v_me, p_option);
  return query
    select a.correct, q.respuesta_correcta, q.explicacion
      from public.match_answers a
      join public.match_questions mq on mq.match_id = a.match_id and mq.question_index = a.question_index
      join public.questions q on q.id = mq.question_id
     where a.match_id = p_match and a.question_index = p_index;
end $$;

-- Resultado de una pregunta ya cerrada: aquí se revela la respuesta correcta a todos los jugadores.
create function public.get_question_result(p_match uuid, p_index integer)
returns table (question_index integer, player_id uuid, result text, option_chosen smallint,
               respuesta_correcta smallint, explicacion text)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.uid_or_raise();
  if not private.is_match_player(p_match) then raise exception 'No estás en esa partida'; end if;
  perform private.advance_match(p_match);
  return query
    select mq.question_index, mq.player_id, mq.result, a.option_chosen, q.respuesta_correcta, q.explicacion
      from public.match_questions mq
      join public.questions q on q.id = mq.question_id
      left join public.match_answers a on a.match_id = mq.match_id and a.question_index = mq.question_index
     where mq.match_id = p_match and mq.question_index = p_index and mq.closed_at is not null;
end $$;

-- Al terminar los turnos, cada jugador envía el resultado que calculó su motor: {"<user_id>": puntos, …}.
-- Cuando lo han enviado todos los que siguen en la partida: si coinciden, se guardan los puntos y gana el que
-- más tiene (con empate, sin ganador); si no coinciden, la partida termina como 'disputed' para revisarla.
create function public.report_result(p_match uuid, p_scores jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.lock_active_player(p_match); v_faltan integer; v_distintos integer;
        v_max integer; v_ganadores integer; v_ganador uuid;
begin
  if jsonb_typeof(p_scores) <> 'object' then raise exception 'El resultado debe ser un objeto {usuario: puntos}'; end if;
  update public.match_players set reported_scores = p_scores where match_id = p_match and user_id = v_me;
  select count(*) filter (where reported_scores is null), count(distinct reported_scores)
    into v_faltan, v_distintos
    from public.match_players where match_id = p_match and not forfeited;
  if v_faltan > 0 then return; end if;
  if v_distintos > 1 then
    perform private.finish_match(p_match, null, 'disputed');
    return;
  end if;
  update public.match_players mp set score = (p_scores ->> mp.user_id::text)::integer
   where mp.match_id = p_match and p_scores ? mp.user_id::text;
  select max(score) into v_max from public.match_players where match_id = p_match and not forfeited;
  select count(*), min(user_id::text)::uuid into v_ganadores, v_ganador
    from public.match_players where match_id = p_match and not forfeited and score = v_max;
  perform private.finish_match(p_match, case when v_ganadores = 1 then v_ganador end, 'completed');
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
  -- en las partidas en curso, borrar la cuenta es abandonar
  for m in select mp.match_id from public.match_players mp join public.matches x on x.id = mp.match_id
            where mp.user_id = p_user and x.status = 'in_progress' and not mp.forfeited loop
    perform private.forfeit(m.match_id, p_user);
  end loop;
  for m in select id from public.matches where host_id = p_user and status = 'lobby' for update loop
    select user_id into v_nuevo from public.match_players
     where match_id = m.id and user_id <> p_user order by seat limit 1;
    if v_nuevo is null then delete from public.matches where id = m.id;
    else update public.matches set host_id = v_nuevo where id = m.id; end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════ PERMISOS DE FUNCIONES

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_group_member(bigint), private.is_group_admin(bigint),
  private.is_group_invited(bigint), private.is_match_player(uuid), private.can_answer(uuid, integer)
to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.my_profile(), public.send_friend_request(text), public.respond_friend_request(bigint, boolean),
  public.remove_friend(bigint), public.block_user(uuid), public.create_group(text),
  public.invite_to_group(bigint, text), public.respond_group_invitation(bigint, boolean),
  public.cancel_group_invitation(bigint, uuid), public.leave_group(bigint), public.remove_group_member(bigint, uuid),
  public.create_match(text, integer, integer), public.join_match(text), public.leave_match(uuid),
  public.start_match(uuid), public.heartbeat(uuid), public.claim_forfeit(uuid, uuid),
  public.submit_action(uuid, integer, text, jsonb), public.draw_question(uuid, text, integer, integer, text),
  public.get_current_question(uuid), public.use_lifeline(uuid, integer, text),
  public.submit_answer(uuid, integer, integer), public.get_question_result(uuid, integer),
  public.report_result(uuid, jsonb)
to authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════ REALTIME
-- Cambios en vivo (Realtime aplica RLS: cada cliente solo recibe lo que puede leer).
-- match_actions es el canal principal de la partida: cada jugada nueva llega a todos los motores.
alter publication supabase_realtime add table
  public.friendships, public.group_members, public.group_invitations,
  public.matches, public.match_players, public.match_actions, public.match_answers;
