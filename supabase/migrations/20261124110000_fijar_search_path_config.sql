-- Fija el search_path de las dos funciones constantes de configuración del esquema private
-- (aviso «function_search_path_mutable» de los advisors de Supabase).
-- Las funciones no usan ningún objeto del esquema: devuelven un número, así que '' no cambia su comportamiento.
alter function private.cfg_segundos_apertura() set search_path = '';
alter function private.cfg_segundos_abandono() set search_path = '';
