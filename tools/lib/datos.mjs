// Carga y valida todo lo que hay en data/. Lo usan build.mjs, validar.mjs y los tests.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA = path.join(RAIZ, "data");
export const NIVELES = 7;
export const MIN_OPCIONES = 3, MAX_OPCIONES = 4;
const CAMPOS = ["id", "bloque", "tema", "b", "n", "q", "o", "a", "d", "fuente", "origen", "revisar"];

const leerJSON = f => {
  try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); }
  catch (e) { throw new Error(`${path.relative(RAIZ, f)}: JSON no válido (${e.message})`); }
};

/* Categorías del juego (las que pintan casillas, ruleta y cabecera de la pregunta):
   data/categorias.json → [ { clave, nombre, color, norma? }, ... ]  El orden es el de la ruleta. */
export function cargarCategorias(errores) {
  const lista = leerJSON(path.join(DATA, "categorias.json"));
  const cat = {};
  if (!Array.isArray(lista)) { errores.push("categorias.json: debe ser una lista"); return cat; }
  lista.forEach((c, i) => {
    if (!c.clave || !c.nombre) errores.push(`categorias.json #${i + 1}: faltan "clave" o "nombre"`);
    else if (cat[c.clave]) errores.push(`categorias.json: la clave "${c.clave}" está repetida`);
    else cat[c.clave] = { nombre: c.nombre, color: c.color || "var(--gris)", orden: i, norma: c.norma };
  });
  return cat;
}

/* Bancos de preguntas: data/preguntas/*.json (las subcarpetas no se cargan).
   Formato de cada archivo (un archivo por bloque del temario: legislativo, policial, tráfico…):
     { "bloque": "legislativo", "temas": {...}, "preguntas": [ {id, tema, b, n, q, o, a, d, fuente, revisar?}, ... ] }
   "b" es la categoría del juego; si todas las preguntas del archivo son de la misma, puede ir
   una sola vez arriba como "categoria". También vale una lista suelta de preguntas.
   Las preguntas con "revisar" se validan pero NO entran en el juego hasta que se quite ese campo. */
export function cargarPreguntas(categorias, errores, avisos) {
  const dir = path.join(DATA, "preguntas");
  const ficheros = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".json")).map(e => e.name).sort();
  const todas = [], porArchivo = {};
  for (const f of ficheros) {
    const v = leerJSON(path.join(dir, f));
    let lista, defecto = null, bloque = f.replace(/\.json$/, "");
    if (Array.isArray(v)) lista = v;
    else if (v && Array.isArray(v.preguntas)) {
      lista = v.preguntas; defecto = v.categoria || null; bloque = v.bloque || bloque;
      if (typeof v.total === "number" && v.total !== lista.length)
        avisos.push(`${f}: declara "total": ${v.total} pero tiene ${lista.length} preguntas`);
    } else { errores.push(`${f}: debe ser una lista de preguntas o un objeto con "preguntas": [...]`); continue; }
    porArchivo[f] = { bloque, total: lista.length };
    lista.forEach((q, i) => todas.push({ ...q, b: q.b || defecto, _origen: `${f} ${q.id || "#" + (i + 1)}`, _bloque: bloque }));
  }
  validarPreguntas(todas, categorias, errores, avisos);
  const activas = todas.filter(q => !q.revisar);
  return { todas, activas, porArchivo, ficheros };
}

export function validarPreguntas(preguntas, categorias, errores, avisos) {
  const enunciados = new Map(), ids = new Map();
  for (const q of preguntas) {
    const o = q._origen, e = m => errores.push(`${o}: ${m}`);
    if (!q.b) e(`falta la categoría ("b")`);
    else if (!categorias[q.b]) e(`la categoría "${q.b}" no existe en data/categorias.json`);
    if (!Number.isInteger(q.n) || q.n < 1 || q.n > NIVELES) e(`"n" (nivel) debe ser un entero de 1 a ${NIVELES}`);
    if (typeof q.q !== "string" || !q.q.trim()) e(`falta el enunciado ("q")`);
    if (!Array.isArray(q.o) || q.o.length < MIN_OPCIONES || q.o.length > MAX_OPCIONES)
      e(`"o" debe tener entre ${MIN_OPCIONES} y ${MAX_OPCIONES} opciones`);
    else {
      if (q.o.some(x => typeof x !== "string" || !x.trim())) e(`hay opciones vacías`);
      if (new Set(q.o.map(x => String(x).trim().toLowerCase())).size !== q.o.length) e(`hay opciones repetidas`);
      if (!Number.isInteger(q.a) || q.a < 0 || q.a >= q.o.length) e(`"a" (respuesta correcta) debe estar entre 0 y ${q.o.length - 1}`);
    }
    if (typeof q.d !== "string" || !q.d.trim()) avisos.push(`${o}: sin explicación ("d")`);
    const extra = Object.keys(q).filter(k => !CAMPOS.includes(k) && !k.startsWith("_"));
    if (extra.length) avisos.push(`${o}: campos desconocidos ignorados: ${extra.join(", ")}`);
    if (q.id) {
      if (ids.has(q.id)) e(`id repetido (también en ${ids.get(q.id)})`);
      else ids.set(q.id, o);
    }
    if (q.revisar) avisos.push(`${o}: pendiente de revisar, no entra en el juego (${q.revisar})`);
    if (typeof q.q === "string" && !q.revisar) {
      const clave = q.q.trim().toLowerCase();
      if (enunciados.has(clave)) avisos.push(`${o}: enunciado repetido (igual que ${enunciados.get(clave)})`);
      else enunciados.set(clave, o);
    }
  }
}

export function cargarTodo() {
  const errores = [], avisos = [];
  const categorias = cargarCategorias(errores);
  const p = cargarPreguntas(categorias, errores, avisos);
  const escalafon = leerJSON(path.join(DATA, "escalafon.json"));
  const casillas = leerJSON(path.join(DATA, "casillas.json"));
  const eventos = leerJSON(path.join(DATA, "cartas-evento.json"));

  if (!Array.isArray(escalafon) || escalafon.length < 2) errores.push("escalafon.json: debe ser una lista de categorías");
  else escalafon.forEach((g, i) => {
    if (!g.n || typeof g.m !== "number" || typeof g.req !== "number") errores.push(`escalafon.json #${i + 1}: faltan "n", "m" o "req"`);
  });

  const conPreguntas = new Set(p.activas.map(q => q.b));
  if (!Array.isArray(casillas)) errores.push("casillas.json: debe ser una lista");
  else {
    for (const t of ["salida", "juzgado", "tunel", "salidatunel"])
      if (!casillas.some(c => c.t === t)) errores.push(`casillas.json: falta la casilla de tipo "${t}"`);
    casillas.forEach((c, i) => { if (!c.n || !c.t || !c.f) errores.push(`casillas.json #${i + 1}: faltan "n", "t" o "f"`); });
    const tiposNoTemario = new Set(["salida", "descanso", "jefatura", "juzgado", "tunel", "salidatunel", "accion", "regalo", "sancion"]);
    for (const c of casillas) if (!tiposNoTemario.has(c.t) && !conPreguntas.has(c.t))
      errores.push(`casillas.json: la casilla "${c.n}" es de la categoría "${c.t}", que no tiene preguntas activas`);
    for (const k of conPreguntas) if (!casillas.some(c => c.t === k))
      avisos.push(`Categoría ${k}: no tiene casillas en el tablero; sus preguntas saldrán en la ruleta y en las preguntas de turno`);
  }
  for (const k of Object.keys(categorias)) if (!conPreguntas.has(k))
    avisos.push(`Categoría ${k}: definida en categorias.json pero sin preguntas activas`);

  if (!Array.isArray(eventos)) errores.push("cartas-evento.json: debe ser una lista");
  else eventos.forEach((e, i) => {
    if (!e.t || !e.x || !e.tipo || typeof e.peso !== "number") errores.push(`cartas-evento.json #${i + 1}: faltan "tipo", "t", "x" o "peso"`);
    if (e.tipo === "efecto" && !e.efecto) errores.push(`cartas-evento.json #${i + 1}: tipo "efecto" sin campo "efecto"`);
  });

  for (const k of conPreguntas) {
    const falta = [];
    for (let n = 1; n <= NIVELES; n++) if (!p.activas.some(q => q.b === k && q.n === n)) falta.push(n);
    if (falta.length) avisos.push(`Categoría ${k}: sin preguntas de nivel ${falta.join(", ")}`);
  }
  return { categorias, ...p, escalafon, casillas, eventos, errores, avisos };
}
