-- La jugada «resultado» incluye los segundos que le sobraban a quien respondió, en décimas, para que todos los
-- motores calculen los mismos puntos que el modo local (base + segundos restantes × 8) sin depender del reloj
-- de cada móvil. En 'timeout' son 0.
-- Al responder, submit_answer inserta la respuesta y el trigger cierra la pregunta en la misma transacción,
-- así que now() es la hora de la respuesta. El +10 s del comodín ya está en closes_at.
-- Misma firma, mismo dueño y mismos permisos: solo cambia el contenido de la jugada.
create or replace function private.close_question(p_match uuid, p_index integer, p_result text, p_option smallint)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_player uuid; v_closes timestamptz; v_seg numeric;
begin
  update public.match_questions set closed_at = now(), result = p_result
   where match_id = p_match and question_index = p_index and closed_at is null
   returning player_id, closes_at into v_player, v_closes;
  if not found then return; end if;
  v_seg := case when p_result = 'timeout' then 0
                else round(greatest(0, floor(extract(epoch from (v_closes - now())) * 10) / 10), 1) end;
  perform private.append_action(p_match, null, 'resultado', jsonb_build_object(
    'question_index', p_index, 'player', v_player, 'result', p_result, 'option', p_option,
    'segundos_restantes', v_seg));
end $$;
