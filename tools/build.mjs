#!/usr/bin/env node
// Inyecta el contenido de data/ en index.html, entre las marcas @DATOS.
// El juego sigue siendo un único archivo que funciona sin servidor (doble clic).
//
//   node tools/build.mjs           regenera index.html
//   node tools/build.mjs --check   falla si index.html no está al día con data/ (para CI)
import fs from "node:fs";
import path from "node:path";
import { RAIZ, cargarTodo } from "./lib/datos.mjs";

const INI = "/*@DATOS:inicio";
const FIN = "/*@DATOS:fin*/";
const HTML = path.join(RAIZ, "index.html");
const check = process.argv.includes("--check");

const d = cargarTodo();
if (d.errores.length) {
  d.errores.forEach(e => console.error("ERROR:", e));
  console.error(`\n${d.errores.length} error(es). index.html no se ha tocado.`);
  process.exit(1);
}
if (d.avisos.length) console.warn(`${d.avisos.length} aviso(s). Para verlos: node tools/validar.mjs`);

const J = v => JSON.stringify(v);
const lista = arr => "[\n" + arr.map(J).join(",\n") + "\n]";
// Todas las categorías (para poder nombrarlas siempre); en la ruleta solo las que tienen preguntas.
const todasCat = Object.entries(d.categorias).sort((a, b) => a[1].orden - b[1].orden).map(([k]) => k);
const conPreguntas = new Set(d.activas.map(q => q.b));
const orden = todasCat.filter(k => conPreguntas.has(k));
const bloques = Object.fromEntries(todasCat.map(k => [k, { nombre: d.categorias[k].nombre, color: d.categorias[k].color }]));
// Al juego solo llegan los campos que usa (más el id, para estadísticas futuras).
const preguntas = d.activas
  .slice().sort((a, b) => a.n - b.n || orden.indexOf(a.b) - orden.indexOf(b.b))
  .map(({ id, b, n, q, o, a, d }) => Object.assign(id ? { id } : {}, { b, n, q, o, a }, d ? { d } : {}));

const generado = [
  `const PREGUNTAS=${lista(preguntas)};`,
  `const BLOQUES=${J(bloques)};`,
  `const CLAVES_BLOQUE=${J(orden)};`,
  `const ESCALAFON=${lista(d.escalafon)};`,
  `const TABLERO=${lista(d.casillas)};`,
  `const EVENTOS_DATOS=${lista(d.eventos)};`
].join("\n");

// Se trabaja siempre en LF; al guardar se respeta el fin de línea que ya tuviera el archivo.
const bruto = fs.readFileSync(HTML, "utf8");
const eol = bruto.includes("\r\n") ? "\r\n" : "\n";
const src = bruto.replace(/\r\n/g, "\n");
const i = src.indexOf(INI), f = src.indexOf(FIN);
if (i < 0 || f < i) { console.error("ERROR: no encuentro las marcas @DATOS en index.html"); process.exit(1); }
const cab = src.slice(i, src.indexOf("*/", i) + 2);
const nuevo = (src.slice(0, i) + cab + "\n" + generado + "\n" + src.slice(f)).replace(/\n/g, eol);

const fuera = d.todas.length - d.activas.length;
const resumen = `${preguntas.length} preguntas (${orden.map(k => `${k}: ${preguntas.filter(q => q.b === k).length}`).join(", ")})` +
  (fuera ? `, ${fuera} pendientes de revisar fuera del juego` : "") + ` · ${d.casillas.length} casillas · ${d.eventos.length} cartas de evento`;
if (check) {
  if (nuevo !== bruto) { console.error("ERROR: index.html no está al día con data/. Ejecuta: node tools/build.mjs"); process.exit(1); }
  console.log("OK, index.html al día ·", resumen);
} else {
  if (nuevo !== bruto) fs.writeFileSync(HTML, nuevo, "utf8");
  console.log((nuevo !== bruto ? "index.html regenerado · " : "Sin cambios · ") + resumen);
}
