-- 3d · Final de partida online (solo 1 contra 1): marcador de puntos, monedas online y logros online.
--
-- Todo se aplica en el servidor, una sola vez por partida, desde private.finish_match (por donde pasan los tres
-- finales: completed, forfeit y disputed). El cliente solo lee; escriben únicamente funciones security definer.
--
-- · game_config: cantidades y límites (se cambian desde el panel, sin tocar código).
--     puntos_1v1  {"ganador": 30, "perdedor": -5, "empate": 30}
--     monedas_1v1 {"jugar": 20, "ganar": 30, "abandonar": 0, "empate": 20, "max_diarias_mismo_rival": 5,
--                  "zona_horaria": "Europe/Madrid"}
--     ligas       tramos del marcador (para la 3e; aquí solo se guardan)
-- · Puntos: empiezan en 0, sin temporadas; el saldo no baja de 0 (despues = greatest(0, antes + delta) y
--   score_changes.delta guarda el cambio real). Ganador +30, perdedor −5, abandono = derrota, empate +30 para los dos.
-- · Monedas: 20 por jugar, +30 por ganar, 0 por abandonar, 20 por empate. Solo las 5 primeras partidas con premio
--   del día (hora de Madrid) contra el mismo rival dan monedas; los puntos cuentan siempre. Una partida se cobra
--   una sola vez (índice único por jugador, motivo y partida).
-- · Logros online (20 monedas cada uno): primera victoria, 10 victorias, 5 victorias seguidas (un empate o una
--   derrota cortan la racha) y llegar a Bronce (100 puntos, el tramo «Bronce» de game_config.ligas).
-- · disputed: no cambia nada (ni puntos, ni monedas, ni progreso).
-- · La jugada «fin» lleva «premios»: por jugador, resultado, puntos (cambio real), total, monedas y logros nuevos,
--   para que los dos móviles enseñen lo mismo.
-- No es destructiva: tablas nuevas y private.finish_match con el mismo comportamiento más el reparto.

-- ═══════════════════════════════════════════════════════════════ TABLAS

create table public.game_config (
  clave text primary key,
  valor jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.game_config (clave, valor) values
  ('puntos_1v1', '{"ganador": 30, "perdedor": -5, "empate": 30}'),
  ('monedas_1v1', '{"jugar": 20, "ganar": 30, "abandonar": 0, "empate": 20, "max_diarias_mismo_rival": 5, "zona_horaria": "Europe/Madrid"}'),
  ('ligas', '[{"nombre": "Sin liga", "desde": 0}, {"nombre": "Bronce", "desde": 100}, {"nombre": "Plata", "desde": 200}, {"nombre": "Oro", "desde": 300}]');

create table public.scores (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  puntos integer not null default 0 constraint scores_puntos_min check (puntos >= 0),
  partidas integer not null default 0,
  ganadas integer not null default 0,
  perdidas integer not null default 0,
  empatadas integer not null default 0,
  updated_at timestamptz not null default now()
);
create index scores_puntos_idx on public.scores (puntos desc);

create table public.score_changes (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  antes integer not null,
  despues integer not null,
  delta integer not null,                    -- cambio real (con el suelo de 0)
  resultado text not null constraint score_changes_resultado check (resultado in ('win', 'loss', 'draw')),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)            -- una partida nunca puntúa dos veces
);
create index score_changes_user_idx on public.score_changes (user_id, created_at);

create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  monedas integer not null default 0 constraint wallets_monedas_min check (monedas >= 0),
  traspaso_local_at timestamptz,             -- traspaso de las monedas locales: pendiente (no se implementa aquí)
  updated_at timestamptz not null default now()
);

create table public.coin_movements (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null,
  motivo text not null constraint coin_movements_motivo
    check (motivo in ('traspaso_local', 'partida_online', 'partida_local', 'compra', 'logro', 'ajuste')),
  match_id uuid references public.matches (id) on delete set null,
  item_id text,                              -- logro: id del logro; compra (3e): id de la pieza
  origen text,
  created_at timestamptz not null default now()
);
create index coin_movements_user_idx on public.coin_movements (user_id, created_at);
-- cobro único: una partida online se cobra una sola vez por jugador
create unique index coin_movements_partida_unica on public.coin_movements (user_id, motivo, match_id)
  where motivo = 'partida_online';
create unique index coin_movements_logro_unico on public.coin_movements (user_id, item_id) where motivo = 'logro';

create table public.achievements (
  id text primary key,
  nombre text not null,
  descripcion text not null,
  metrica text not null,                     -- victorias_online, mejor_racha_online, puntos
  objetivo integer not null constraint achievements_objetivo check (objetivo > 0),
  premio_monedas integer not null default 0 constraint achievements_premio check (premio_monedas >= 0),
  activo boolean not null default true
);
insert into public.achievements (id, nombre, descripcion, metrica, objetivo, premio_monedas) values
  ('online_primera_victoria', 'Primera victoria online', 'Gana tu primera partida online', 'victorias_online', 1, 20),
  ('online_10_victorias', '10 victorias online', 'Gana 10 partidas online', 'victorias_online', 10, 20),
  ('online_racha_5', '5 victorias seguidas online', 'Gana 5 partidas online seguidas', 'mejor_racha_online', 5, 20),
  ('online_bronce', 'Llegar a Bronce', 'Llega a 100 puntos en el marcador online', 'puntos', 100, 20);

create table public.user_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  metrica text not null,                     -- partidas_online, victorias_online, racha_online, mejor_racha_online, puntos
  valor integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, metrica)
);

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id) on delete cascade,
  match_id uuid references public.matches (id) on delete set null,
  conseguido_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

-- ═══════════════════════════════════════════════════════════════ PERMISOS Y RLS (solo lectura para el cliente)

revoke all on public.game_config, public.scores, public.score_changes, public.wallets, public.coin_movements,
  public.achievements, public.user_progress, public.user_achievements from anon, authenticated;
grant select on public.game_config, public.scores, public.score_changes, public.wallets, public.coin_movements,
  public.achievements, public.user_progress, public.user_achievements to authenticated;

alter table public.game_config enable row level security;
alter table public.scores enable row level security;
alter table public.score_changes enable row level security;
alter table public.wallets enable row level security;
alter table public.coin_movements enable row level security;
alter table public.achievements enable row level security;
alter table public.user_progress enable row level security;
alter table public.user_achievements enable row level security;

create policy "game_config: lectura con sesión" on public.game_config for select to authenticated using (true);
create policy "scores: lectura con sesión (clasificación)" on public.scores for select to authenticated using (true);
create policy "score_changes: el propio y los de sus partidas" on public.score_changes for select to authenticated
  using (user_id = (select auth.uid()) or private.is_match_player(match_id));
create policy "wallets: solo su dueño" on public.wallets for select to authenticated using (user_id = (select auth.uid()));
create policy "coin_movements: solo su dueño" on public.coin_movements for select to authenticated using (user_id = (select auth.uid()));
create policy "achievements: lectura con sesión" on public.achievements for select to authenticated using (true);
create policy "user_progress: solo su dueño" on public.user_progress for select to authenticated using (user_id = (select auth.uid()));
create policy "user_achievements: solo su dueño" on public.user_achievements for select to authenticated using (user_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════ FUNCIONES

create function private.cfg(p_clave text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select valor into v from public.game_config where clave = p_clave;
  if v is null then raise exception 'Falta la configuración %', p_clave; end if;
  return v;
end $$;

create function private.add_coins(p_user uuid, p_delta integer) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.wallets (user_id, monedas) values (p_user, p_delta)
  on conflict (user_id) do update set monedas = public.wallets.monedas + excluded.monedas, updated_at = now();
$$;

create function private.bump_progress(p_user uuid, p_metrica text, p_suma integer) returns integer
language sql volatile security definer set search_path = '' as $$
  insert into public.user_progress (user_id, metrica, valor) values (p_user, p_metrica, p_suma)
  on conflict (user_id, metrica) do update set valor = public.user_progress.valor + excluded.valor, updated_at = now()
  returning valor;
$$;

create function private.set_progress(p_user uuid, p_metrica text, p_valor integer, p_solo_si_mayor boolean) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.user_progress (user_id, metrica, valor) values (p_user, p_metrica, p_valor)
  on conflict (user_id, metrica) do update
    set valor = case when p_solo_si_mayor then greatest(public.user_progress.valor, excluded.valor) else excluded.valor end,
        updated_at = now();
$$;

-- (el reparto en private.finish_match llega en el siguiente commit)

revoke execute on function private.cfg(text), private.add_coins(uuid, integer), private.bump_progress(uuid, text, integer),
  private.set_progress(uuid, text, integer, boolean)
  from public, anon, authenticated;
