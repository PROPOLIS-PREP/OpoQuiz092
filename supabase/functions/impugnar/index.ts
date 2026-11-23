// Recibe una impugnación de pregunta desde el juego Patrullan2, la guarda en public.impugnaciones
// y la envía por correo con Resend.
// Es pública (el juego no tiene usuarios): se protege con validación, un campo trampa y límites por hora.
// Desplegada en App PROPOLIS con verify_jwt = false.
//
// Secretos (Edge Functions > Secrets):
//   RESEND_API_KEY   clave de resend.com (sin ella, la impugnación se guarda pero no se envía correo)
//   IMPUGNAR_A       destinatario (por defecto oposicionesmunicipal@gmail.com)
//   IMPUGNAR_DE      remitente (por defecto onboarding@resend.dev, válido sin dominio propio)
//   HASH_SAL         sal para la huella anónima del origen
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const POR_ORIGEN_HORA = 5, TOTAL_HORA = 60;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const entero = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function huella(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "desconocida";
  const datos = new TextEncoder().encode(ip + (Deno.env.get("HASH_SAL") || "patrullan2"));
  const h = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "método no permitido" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ ok: false, error: "JSON no válido" }, 400); }

  // campo trampa: las personas no lo ven; si viene relleno, se responde ok sin hacer nada
  if (texto(b.web, 200)) return json({ ok: true });

  const motivo = texto(b.motivo, 1200);
  const pregunta_id = texto(b.pregunta_id, 40);
  if (motivo.length < 5) return json({ ok: false, error: "falta el motivo" }, 400);
  if (!pregunta_id) return json({ ok: false, error: "falta la pregunta" }, 400);
  const opciones = Array.isArray(b.opciones) ? b.opciones.slice(0, 4).map((o) => texto(o, 300)) : [];
  const fila = {
    pregunta_id, motivo,
    bloque: texto(b.bloque, 40) || null,
    nivel: entero(b.nivel, 1, 7),
    enunciado: texto(b.enunciado, 1000) || null,
    opciones,
    correcta: entero(b.correcta, 0, 3),
    marcada: entero(b.marcada, -1, 3),
    explicacion: texto(b.explicacion, 1000) || null,
    version_app: texto(b.version, 40) || null,
    origen_hash: await huella(req),
  };

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const [mias, todas] = await Promise.all([
    db.from("impugnaciones").select("id", { count: "exact", head: true }).eq("origen_hash", fila.origen_hash).gte("creada", haceUnaHora),
    db.from("impugnaciones").select("id", { count: "exact", head: true }).gte("creada", haceUnaHora),
  ]);
  if ((mias.count ?? 0) >= POR_ORIGEN_HORA || (todas.count ?? 0) >= TOTAL_HORA)
    return json({ ok: false, error: "demasiadas impugnaciones; inténtalo más tarde" }, 429);

  const { data, error } = await db.from("impugnaciones").insert(fila).select("id").single();
  if (error) { console.error("insert", error); return json({ ok: false, error: "no se pudo guardar" }, 500); }

  // correo
  let correo = false;
  const L = "ABCD";
  const lineas = opciones.map((o, i) => `${L[i]}) ${o}${i === fila.correcta ? "   ← correcta según el juego" : ""}${i === fila.marcada && i !== fila.correcta ? "   ← marcada" : ""}`);
  const cuerpo = `Motivo de la impugnación:\n${motivo}\n\n— Datos de la pregunta —\nId: ${pregunta_id}\nBloque: ${fila.bloque ?? "?"} · Nivel ${fila.nivel ?? "?"}\n\n${fila.enunciado ?? ""}\n\n${lineas.join("\n")}\n\n` +
    `Respuesta marcada: ${fila.marcada !== null && fila.marcada >= 0 ? L[fila.marcada] : "ninguna (se acabó el tiempo)"}\nExplicación del juego: ${fila.explicacion ?? "(sin explicación)"}\n\nImpugnación n.º ${data.id} · guardada en la tabla impugnaciones de App PROPOLIS.`;
  const asunto = `Impugnación de pregunta ${pregunta_id}`;

  // Opción A: Make (escenario con Gmail). MAKE_WEBHOOK_URL = URL del webhook; el correo sale de la propia cuenta de Gmail.
  const make = Deno.env.get("MAKE_WEBHOOK_URL");
  if (make) {
    try {
      const r = await fetch(make, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ para: Deno.env.get("IMPUGNAR_A") || "oposicionesmunicipal@gmail.com", asunto, html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;font-size:14px">${esc(cuerpo)}</pre>` }),
      });
      correo = r.ok;
      if (!r.ok) console.error("make", r.status, await r.text());
    } catch (e) { console.error("make", e); }
    if (correo) await db.from("impugnaciones").update({ correo_enviado: true }).eq("id", data.id);
  }

  // Opción B: Resend (sin ella ni Make, la impugnación solo se guarda)
  const clave = Deno.env.get("RESEND_API_KEY");
  if (!correo && clave) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Patrullan2 <${Deno.env.get("IMPUGNAR_DE") || "onboarding@resend.dev"}>`,
        to: [Deno.env.get("IMPUGNAR_A") || "oposicionesmunicipal@gmail.com"],
        subject: `Impugnación de pregunta ${pregunta_id}`,
        text: cuerpo,
        html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;font-size:14px">${esc(cuerpo)}</pre>`,
      }),
    });
    correo = r.ok;
    if (!r.ok) console.error("resend", r.status, await r.text());
    else await db.from("impugnaciones").update({ correo_enviado: true }).eq("id", data.id);
  }
  return json({ ok: true, id: data.id, correo });
});
