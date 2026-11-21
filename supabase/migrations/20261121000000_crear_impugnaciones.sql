-- Impugnaciones de preguntas enviadas desde el juego (Patrulla 092).
-- Proyecto de Supabase: App PROPOLIS (auuotygakkegogssmaoy). Aplicada el 21/11/2026.
-- Solo escribe la Edge Function "impugnar" (con la clave de servicio); desde fuera no se puede leer ni escribir.
create table public.impugnaciones (
  id            bigint generated always as identity primary key,
  creada        timestamptz not null default now(),
  pregunta_id   text not null check (char_length(pregunta_id) between 1 and 40),
  bloque        text check (char_length(bloque) <= 40),
  nivel         smallint check (nivel between 1 and 7),
  enunciado     text check (char_length(enunciado) <= 1000),
  opciones      jsonb,
  correcta      smallint,
  marcada       smallint,
  explicacion   text check (char_length(explicacion) <= 1000),
  motivo        text not null check (char_length(motivo) between 5 and 1200),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  nota_revision text,
  correo_enviado boolean not null default false,
  origen_hash   text,          -- huella anónima (IP + sal) para limitar envíos; no se guarda la IP
  version_app   text check (char_length(version_app) <= 40)
);

comment on table public.impugnaciones is 'Impugnaciones de preguntas del juego Patrulla 092. Escribe solo la Edge Function impugnar.';

create index impugnaciones_creada_idx on public.impugnaciones (creada desc);
create index impugnaciones_origen_idx on public.impugnaciones (origen_hash, creada desc);
create index impugnaciones_pregunta_idx on public.impugnaciones (pregunta_id);

alter table public.impugnaciones enable row level security;
-- sin políticas: anon y authenticated no tienen acceso; service_role (la función) salta RLS
revoke all on public.impugnaciones from anon, authenticated;
