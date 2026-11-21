#!/usr/bin/env node
// Valida data/ sin tocar index.html. Muestra errores (bloquean el build) y avisos.
//   node tools/validar.mjs            resumen + todos los avisos
//   node tools/validar.mjs --breve    solo resumen y errores
import { cargarTodo, NIVELES } from "./lib/datos.mjs";

let d;
try { d = cargarTodo(); } catch (e) { console.error("ERROR:", e.message); process.exit(1); }
const breve = process.argv.includes("--breve");

console.log("Archivos de preguntas:");
for (const [f, x] of Object.entries(d.porArchivo)) console.log(`  ${f.padEnd(28)} bloque "${x.bloque}", ${x.total} preguntas`);
console.log(`\nPreguntas activas por bloque y nivel (las marcadas "revisar" no cuentan):`);
console.log("  bloque".padEnd(14) + Array.from({ length: NIVELES }, (_, i) => `n${i + 1}`.padStart(5)).join("") + "  total");
for (const [k, c] of Object.entries(d.categorias)) {
  const de = d.activas.filter(q => q.b === k);
  const fila = Array.from({ length: NIVELES }, (_, i) => String(de.filter(q => q.n === i + 1).length).padStart(5)).join("");
  console.log("  " + k.padEnd(12) + fila + String(de.length).padStart(7) + `  ${c.nombre}`);
}
const tres = d.activas.filter(q => q.o?.length === 3).length;
console.log(`  total: ${d.activas.length} activas (${tres} con 3 opciones), ${d.todas.length - d.activas.length} pendientes de revisar\n`);
if (!breve) d.avisos.forEach(a => console.warn("aviso:", a));
d.errores.forEach(e => console.error("ERROR:", e));
console.log(`\n${d.errores.length} error(es), ${d.avisos.length} aviso(s).`);
process.exit(d.errores.length ? 1 : 0);
