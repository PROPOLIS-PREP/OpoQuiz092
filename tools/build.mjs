#!/usr/bin/env node
// Inyecta el contenido de data/ en index.html, entre las marcas @DATOS.
// El juego sigue siendo un único archivo que funciona sin servidor (doble clic).
//
//   node tools/build.mjs           regenera index.html
//   node tools/build.mjs --check   falla si index.html no está al día con data/ (para CI)
import fs from "node:fs";
import path from "node:path";
import { RAIZ, cargarTodo, cargarAvatar } from "./lib/datos.mjs";

const INI = "/*@DATOS:inicio";
const FIN = "/*@DATOS:fin*/";
const HTML = path.join(RAIZ, "index.html");
const check = process.argv.includes("--check");

const d = cargarTodo();
const av = cargarAvatar(d.errores);
if (d.errores.length) {
  d.errores.forEach(e => console.error("ERROR:", e));
  console.error(`\n${d.errores.length} error(es). index.html no se ha tocado.`);
  process.exit(1);
}
if (d.avisos.length) console.warn(`${d.avisos.length} aviso(s). Para verlos: node tools/validar.mjs`);

const J = v => JSON.stringify(v);
const lista = arr => "[\n" + arr.map(J).join(",\n") + "\n]";
// Los bloques del temario, en el orden de la ruleta. Todos salen en la ruleta y en el tablero;
// "n" es cuántas preguntas tiene cada uno (con 0, el juego saca una pregunta de otro bloque).
const orden = Object.entries(d.categorias).sort((a, b) => a[1].orden - b[1].orden).map(([k]) => k);
const bloques = Object.fromEntries(orden.map(k => [k, { nombre: d.categorias[k].nombre, color: d.categorias[k].color,
  ico: d.categorias[k].ico, n: d.activas.filter(q => q.b === k).length }]));
// Grupos de gemelas (o de enunciado idéntico) entre las activas: "g" numera solo los de 2 o más.
const tam = new Map();
d.activas.forEach(q => tam.set(q._grupo, (tam.get(q._grupo) || 0) + 1));
const numGrupo = new Map();
for (const [k, n] of tam) if (n > 1) numGrupo.set(k, numGrupo.size + 1);
// Al juego solo llegan los campos que usa (más el id, para estadísticas futuras).
const preguntas = d.activas
  .slice().sort((a, b) => a.n - b.n || orden.indexOf(a.b) - orden.indexOf(b.b))
  .map(({ id, b, n, q, o, a, d, _grupo }) => Object.assign(id ? { id } : {}, { b, n, q, o, a }, d ? { d } : {},
    numGrupo.has(_grupo) ? { g: numGrupo.get(_grupo) } : {}));

const generado = [
  `const PREGUNTAS=${lista(preguntas)};`,
  `const BLOQUES=${J(bloques)};`,
  `const CLAVES_BLOQUE=${J(orden)};`,
  `const ESCALAFON=${lista(d.escalafon)};`,
  `const TABLERO=${lista(d.casillas)};`,
  `const EVENTOS_DATOS=${lista(d.eventos)};`,
  `const AV_LAYOUT=${J(av.layout)};`,
  "const AV_IMG={\n" + Object.entries(av.imagenes).map(([k, v]) => `${J(k)}:${J(v)}`).join(",\n") + "\n};"
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
const resumen = `${preguntas.length} preguntas (${orden.map(k => `${k}: ${bloques[k].n}`).join(", ")})` +
  (fuera ? `, ${fuera} pendientes de revisar fuera del juego` : "") + ` · ${d.casillas.length} casillas · ${d.eventos.length} cartas de evento · ${Object.keys(av.imagenes).length} imágenes de avatar (${Math.round(av.bytes / 1024)} KB)`;
if (check) {
  if (nuevo !== bruto) { console.error("ERROR: index.html no está al día con data/. Ejecuta: node tools/build.mjs"); process.exit(1); }
  console.log("OK, index.html al día ·", resumen);
} else {
  if (nuevo !== bruto) fs.writeFileSync(HTML, nuevo, "utf8");
  console.log((nuevo !== bruto ? "index.html regenerado · " : "Sin cambios · ") + resumen);
}
