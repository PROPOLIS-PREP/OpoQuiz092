// Borra la cuenta del usuario que llama: sus datos de juego y su usuario de Supabase Auth.
// Requiere una sesión válida (cabecera Authorization: Bearer <access_token>). Desplegar con verify_jwt = true.
//
// Pasos:
//   1. Comprueba el token y obtiene el usuario.
//   2. prepare_account_deletion(uid): sale de sus grupos (cede la propiedad si hace falta), abandona sus
//      partidas en curso (las pierde) y pasa el anfitrión de sus partidas en el lobby a otro jugador.
//   3. auth.admin.deleteUser(uid): al borrarse auth.users se borran en cascada profiles, friendships,
//      group_members, group_invitations, match_players y match_answers.
//
// Variables (las pone Supabase automáticamente): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "método no permitido" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "falta la sesión" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: { user }, error: errUser } = await usuario.auth.getUser();
  if (errUser || !user) return json({ ok: false, error: "sesión no válida" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { error: errPrep } = await admin.rpc("prepare_account_deletion", { p_user: user.id });
  if (errPrep) { console.error("prepare_account_deletion", errPrep); return json({ ok: false, error: "no se pudo preparar el borrado" }, 500); }

  const { error: errDel } = await admin.auth.admin.deleteUser(user.id);
  if (errDel) { console.error("deleteUser", errDel); return json({ ok: false, error: "no se pudo borrar la cuenta" }, 500); }

  return json({ ok: true });
});
