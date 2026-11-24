#!/usr/bin/env node
// Carga el banco de preguntas de data/preguntas/*.json en la tabla public.questions de Supabase (v2 online).
// Solo entran las preguntas activas (las marcadas "revisar" se quedan fuera, igual que en el juego).
// Es idempotente: hace upsert por id, así que se puede repetir cada vez que cambie el banco.
//
//   node tools/cargar-preguntas.mjs            carga en el proyecto de .env.local
//   node tools/cargar-preguntas.mjs --seco     solo cuenta lo que cargaría
//
// Necesita en .env.local: SUPABASE_URL y SUPABASE_SECRET_KEY (clave secreta o service_role).
// La tabla questions no tiene políticas para los clientes: solo se puede escribir con la clave secreta.
import fs from "node:fs";
import path from "node:path";
import { RAIZ, cargarTodo } from "./lib/datos.mjs";

const seco = process.argv.includes("--seco");

function leerEnv() {
  const f = path.join(RAIZ, ".env.local");
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
}

const d = cargarTodo();
if (d.errores.length) {
  d.errores.forEach(e => console.error("ERROR:", e));
  process.exit(1);
}
const filas = d.activas.map(q => ({
  id: q.id,
  bloque: q.bloque || q.b,
  tema: Number.isInteger(q.tema) ? q.tema : null,
  nivel: q.n,
  texto: q.q,
  opciones: q.o,
  respuesta_correcta: q.a,
  explicacion: q.d || null,
}));
const sinId = filas.filter(f => !f.id).length;
if (sinId) { console.error(`${sinId} preguntas activas sin id: no se pueden cargar.`); process.exit(1); }
console.log(`${filas.length} preguntas activas para cargar.`);
if (seco) process.exit(0);

const env = { ...leerEnv(), ...process.env };
const url = env.SUPABASE_URL, clave = env.SUPABASE_SECRET_KEY;
if (!url || !clave) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local.");
  process.exit(1);
}

const LOTE = 500;
for (let i = 0; i < filas.length; i += LOTE) {
  const lote = filas.slice(i, i + LOTE);
  const r = await fetch(`${url}/rest/v1/questions?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: clave, Authorization: `Bearer ${clave}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(lote),
  });
  if (!r.ok) { console.error(`Lote ${i / LOTE + 1}: ${r.status} ${await r.text()}`); process.exit(1); }
  console.log(`  ${Math.min(i + LOTE, filas.length)} / ${filas.length}`);
}
console.log("Listo.");
