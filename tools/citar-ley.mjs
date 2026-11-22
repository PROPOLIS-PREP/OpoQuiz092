#!/usr/bin/env node
// Añade al enunciado de cada pregunta la ley a la que se refiere, si no la cita ya,
// para que el jugador sepa de qué norma le preguntan antes de responder.
//
//   node tools/citar-ley.mjs              prueba: resumen y lista de lo que no se puede citar
//   node tools/citar-ley.mjs --escribir   aplica los cambios en data/preguntas/*.json
//   node tools/citar-ley.mjs --todo       muestra además cada cambio (antes / ahora)
//
// La ley sale del campo "fuente" ("LO 4/2010 art. 7", "CE art. 15"…). Si la fuente es genérica
// ("Tema 4", "Tarjetas T33") se busca en la explicación "d"; si no consta una sola ley, no se toca.
// Tampoco se toca la pregunta si alguna opción nombra la ley o una norma concreta: en preguntas
// como "¿Qué norma regula…?" citar la ley daría la respuesta.
// Para un bloque nuevo: añade sus normas a LEYES (o a CASOS para preguntas sueltas) y ejecútalo.
import fs from "node:fs";
import path from "node:path";
import { RAIZ } from "./lib/datos.mjs";
import { BLOQUES_NORMAS, normaDeFuente, normaDeId } from "./lib/normas.mjs";

const escribir = process.argv.includes("--escribir"), todo = process.argv.includes("--todo");
const DIR = path.join(RAIZ, "data", "preguntas");

// art: artículo con que se nombra; fuente: cómo aparece al principio del campo "fuente";
// d: cómo se reconoce dentro de la explicación o de las opciones.
const LEYES = {
  CE: { art: "la", nom: "Constitución", fuente: /^CE\b|^Constituci/, d: /\bCE\b|Constitución/ },
  EACM: { art: "el", nom: "Estatuto de Autonomía de la Comunidad de Madrid", fuente: /^EACM\b|^LO 3\/1983/, d: /\bEACM\b|\bEAM\b|Estatuto de Autonomía/ },
  LRBRL: { art: "la", nom: "LRBRL (Ley 7/1985)", fuente: /^LRBRL\b|^Ley 7\/1985/, d: /\bLRBRL\b|Ley 7\/1985/ },
  LOREG: { art: "la", nom: "LOREG (LO 5/1985)", fuente: /^LOREG\b/, d: /\bLOREG\b/ },
  LOTC: { art: "la", nom: "LOTC (LO 2/1979)", fuente: /^LOTC\b|^LO 2\/1979/, d: /\bLOTC\b/ },
  LO31981: { art: "la", nom: "LO 3/1981, del Defensor del Pueblo", fuente: /^LO 3\/1981/, d: /LO 3\/1981/ },
  LO41981: { art: "la", nom: "LO 4/1981, de los estados de alarma, excepción y sitio", fuente: /^LO 4\/1981/, d: /LO 4\/1981/ },
  TRRL: { art: "el", nom: "TRRL (RDLeg 781/1986)", fuente: /^TRRL\b/, d: /\bTRRL\b/ },
  ROF: { art: "el", nom: "ROF (RD 2568/1986)", fuente: /^ROF\b/, d: /\bROF\b/ },
  ROGA: { art: "el", nom: "ROGA del Ayuntamiento de Madrid", fuente: /^ROGA\b/, d: /\bROGA\b/ },
  LOFCS: { art: "la", nom: "LOFCS (LO 2/1986)", fuente: /^LOFCS\b|^LO 2\/1986/, d: /\bLOFCS\b|LO 2\/1986/ },
  LO42010: { art: "la", nom: "LO 4/2010, de régimen disciplinario del CNP", fuente: /^LO 4\/2010/, d: /LO 4\/2010/ },
  LCPL: { art: "la", nom: "Ley 1/2018, de Coordinación de Policías Locales de la CM", fuente: /^Ley 1\/2018/, d: /Ley 1\/2018/ },
  RM: { art: "el", nom: "Reglamento Marco de Policías Locales de la CM", fuente: /^RM\b/, d: /\bRM\b|Reglamento Marco/ },
  RPMM: { art: "el", nom: "Reglamento de la Policía Municipal de Madrid", fuente: /^Reglamento PMM/, d: /Reglamento PMM/ },
  LOPSC: { art: "la", nom: "LOPSC (LO 4/2015)", fuente: /^LO 4\/2015|^LOPSC/, d: /LO 4\/2015|\bLOPSC\b/ },
  JLS: { art: "el", nom: "RD 1087/2010, de Juntas Locales de Seguridad", fuente: /^RD 1087\/2010/, d: /RD 1087\/2010/ },
  PC: { art: "la", nom: "Ley 17/2015, del Sistema Nacional de Protección Civil", fuente: /^Ley 17\/2015/, d: /Ley 17\/2015/ },
  NBPC: { art: "la", nom: "Norma Básica de Protección Civil (RD 407/1992)", fuente: /^RD 407\/1992/, d: /RD 407\/1992/ },
  PLATERCAM: { art: "el", nom: "PLATERCAM", fuente: /^PLATERCAM/, d: /PLATERCAM/ },
  PEMAM: { art: "el", nom: "PEMAM", fuente: /^PEMAM/, d: /PEMAM/ },
  ARMAS: { art: "el", nom: "Reglamento de Armas (RD 137/1993)", fuente: /^RD 137\/1993/, d: /RD 137\/1993/ },
  D492023: { art: "el", nom: "Decreto 49/2023, de uniformidad de las Policías Locales de la CM", fuente: /^Decreto 49\/2023/, d: /Decreto 49\/2023/ },
  // bloque penal
  CP: { art: "el", nom: "Código Penal", fuente: /^CP\b|^LO 10\/1995|^LO 1\/2015/, d: /\bCP\b|Código Penal/ },
  LOPJ: { art: "la", nom: "LOPJ (LO 6/1985)", fuente: /^LOPJ\b|^LO 6\/1985|^Tema 20 \((TS|TCI|Instancia)\)/, d: /\bLOPJ\b|LO 6\/1985/ },
  LECRIM: { art: "la", nom: "Ley de Enjuiciamiento Criminal", fuente: /^LECrim\b|^LO 13\/2015/, d: /\bLECrim\b|Enjuiciamiento Criminal/ },
  LOTJ: { art: "la", nom: "LO 5/1995, del Tribunal del Jurado", fuente: /^LO 5\/1995|^LOTJ\b/, d: /LO 5\/1995|\bLOTJ\b/ },
  HABEAS: { art: "la", nom: "LO 6/1984, de habeas corpus", fuente: /^LO 6\/1984/, d: /LO 6\/1984/ },
  LORPM: { art: "la", nom: "LO 5/2000, de responsabilidad penal de los menores", fuente: /^LO 5\/2000/, d: /LO 5\/2000/ },
  LO12025: { art: "la", nom: "LO 1/2025, de eficiencia del Servicio Público de Justicia", fuente: /^LO 1\/2025/, d: /LO 1\/2025/ },
  LO102022: { art: "la", nom: "LO 10/2022, de garantía integral de la libertad sexual", fuente: /^LO 10\/2022/, d: /LO 10\/2022/ },
  EXTRAD: { art: "la", nom: "Ley 4/1985, de Extradición Pasiva", fuente: /^Ley 4\/1985/, d: /Ley 4\/1985/ },
};

// Temas cuyas preguntas, si la fuente es genérica ("Tema 23", "Examen PROPOLIS · Tema 23 · …"),
// son siempre de una misma norma. Clave: bloque → { tema: ley }.
const POR_TEMA = {
  penal: { 0: "CP", 21: "CP", 22: "CP", 23: "CP", 24: "CP", 25: "CP", 26: "CP", 27: "CP" },
};

// Preguntas sueltas cuya fuente es genérica pero la norma está clara (clave de LEYES),
// o que necesitan una redacción propia ({ q: "nuevo enunciado" }).
const CASOS = {
  "LEG-TEST1-18": { ley: { art: "la", nom: "Constitución y la LOREG" } },
  "LEG-TEST1-36": "LRBRL",
  "LEG-TEST2-26": "CE",
  "LEG-TEST2-42": "LOREG",
  "LEG-TEST2-46": "ROF",
  "LEG-T1-065": { q: "¿Qué artículo de la Constitución se reformó en 1992 para adaptarse a la normativa de la Unión Europea?" },
  "LEG-T1-066": { q: "¿Qué artículo de la Constitución se reformó en 2011 para garantizar la estabilidad presupuestaria?" },
  "LEG-T1-067": { q: "¿Qué artículo de la Constitución se reformó en 2024 para sustituir «disminuidos» por «personas con discapacidad»?" },
  "LEG-T1-093": "CE",
  "LEG-T2-134": "LOTC",
  "LEG-T2-153": "LOTC",
  "LEG-T2-184": "LO41981",
  "LEG-T2-185": "CE",
  "LEG-T2-190": "LOTC",
  "LEG-T5-056": { omitir: "habla de la ley de símbolos de la Asamblea, no del Estatuto" },
  "LEG-T6-184": { omitir: "pregunta qué reglamento es" },
  "POL-TEST1-18": { q: "La Ley 1/2018, de Coordinación de Policías Locales de la CM, se aplica a:" },
  // penal: denuncia y querella (tema 22) son de la LECrim, no del CP
  "PEN-EXAMEN-099": "LECRIM", "PEN-EXAMEN-198": "LECRIM", "PEN-EXAMEN-199": "LECRIM", "PEN-EXAMEN-200": "LECRIM",
  "PEN-EXAMEN-201": "LECRIM", "PEN-EXAMEN-202": "LECRIM", "PEN-EXAMEN-203": "LECRIM", "PEN-EXAMEN-204": "LECRIM",
  "PEN-EXAMEN-205": "LECRIM",
  // penal: «Según el Anexo» es el anexo de estudio de la PMM, no una norma
  "PEN-EXAMEN-395": { q: "Según el Código Penal, el homicidio por imprudencia menos grave necesita denuncia excepto si se comete:" },
  "PEN-EXAMEN-397": { q: "Según el Código Penal, los actos preparatorios están penados, entre otros, en:" },
  "PEN-EXAMEN-400": { q: "Según el Código Penal, la incitación al suicidio es delictiva en caso de:" },
  "PEN-EXAMEN-406": { q: "Según el Código Penal, el delito de exhibicionismo se comete si es ante:" },
  "POL-T8-083": "RPMM",
  "POL-T9-182": "LO42010",
  "POL-T9-183": "LO42010",
  "POL-T33-026": "LOFCS",
  "POL-T33-027": "LOFCS",
  "POL-T33-034": "LOFCS",
};

// Penal, tema 20 (Poder Judicial y proceso) y tema 21: norma de cada pregunta de fuente genérica.
const asignar = (ley, ids) => ids.forEach(id => { CASOS[id] = ley; });
const ex = (...n) => n.map(x => "PEN-EXAMEN-" + String(x).padStart(3, "0"));
const t20 = (...n) => n.map(x => "PEN-T20-" + String(x).padStart(3, "0"));
asignar("CE", ex(4, 5, 6, 19, 20, 24, 26, 147));
asignar("LOPJ", ex(17, 22, 23, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  51, 52, 53, 54, 56, 57, 58, 59, 60, 61, 62, 63, 64));
asignar("LECRIM", [...ex(12, 13, 14, 16, 75, 76, 77, 78, 79, 80),
  ...t20(99, 100, 117, 122, 123, 124, 127, 128, 129, 131, 175, 176, 178)]);
asignar("LORPM", ex(15));
asignar("LOTJ", ex(66, 67, 68, 69, 70, 71, 72, 73, 74));
asignar("HABEAS", ex(55, 82, 83, 84, 85));
asignar("LOTC", ex(141, 142));
// doctrina o normas que la herramienta no recoge: mejor sin cita que con una cita engañosa
for (const id of [...ex(1, 8, 9, 10, 11, 65, 87, 92, 96, 97, 98, 128, 129, 135, 137, 138, 139, 149),
  ...t20(22, 23, 57, 83, 84, 89, 90, 91, 103, 104, 105, 106, 108, 112, 113, 114, 125, 126, 130),
  "PEN-T21-050", "PEN-T21-085", "PEN-T21-097"])
  CASOS[id] = { omitir: "doctrina o norma no concreta" };

// el enunciado ya nombra una norma ("ley" o "reglamento" en minúscula son conceptos, no citas)
const CITA = /\b(LO|L\.O\.|Ley|Leyes|Real Decreto|RD|RDLeg|Decreto|LOFCS|LOPSC|LRBRL|LOREG|LOTC|TRRL|TREBEP|ROF|Reglamento|Constituci[oó]n|CE|Estatuto|EACM|EAM|ROGA|PLATERCAM|PEMAM|C[oó]digo|LCPLCM|RM|LECrim|CP|LOPJ|LOTJ|LORPM|Ordenanza|Ordenanzas|OPMAU|LEPAR|LOEx|LPRL|LTSV|LSV|RDL|Orden de|Orden INT|Directiva|Acuerdo-Convenio|Plan de Igualdad|Protocolo|RGCir|RGCon|RGV|RSOA|Estatuto de los Trabajadores)\b/;
// una opción nombra una norma concreta: la pregunta trata de qué norma es
const NORMA_CONCRETA = /\b(LO|Ley|RD|Real Decreto|Decreto|RDLeg)\s+\d+\/\d{4}|\b(LOFCS|LOPSC|LRBRL|LOREG|LOTC|TRRL|TREBEP|ROGA|EACM|PLATERCAM|PEMAM|LOPJ|LECrim|LOTJ|LORPM)\b/;
const GENERICA = /^(Tema|Tarjetas|Tabla|Hoja|Examen PROPOLIS)\b/;
const NO_MINUSCULA = new Set(["España", "Madrid"]);

const conArt = l => `${l.art} ${l.nom}`;
const deLa = l => (l.art === "el" ? `del ${l.nom}` : `de la ${l.nom}`);

function leyDe(q, bloque) {
  const caso = CASOS[q.id];
  if (typeof caso === "string") return LEYES[caso];
  if (caso && caso.ley) return caso.ley;
  const fuente = (q.fuente || "").trim();
  if (BLOQUES_NORMAS.has(bloque)) { const n = normaDeId(q.id) || normaDeFuente(fuente); if (n) return n; }
  // cada parte de la fuente: una ley conocida, algo genérico ("Tema 4") o algo desconocido
  const partes = fuente.split(" / ").map(s => s.trim()).filter(Boolean)
    .map(p => Object.keys(LEYES).find(k => LEYES[k].fuente.test(p)) || (GENERICA.test(p) ? null : "?"));
  if (partes.includes("?")) return null;               // norma que la herramienta no conoce
  const leyes = new Set(partes.filter(Boolean));
  if (leyes.size > 1) return null;                     // varias normas a la vez
  if (leyes.size === 1) return LEYES[[...leyes][0]];
  // fuente genérica: la ley puede ir al final ("Examen PROPOLIS · Tema 20 · Art. 117 CE") o en la explicación
  const cola = fuente.split("·").pop();
  for (const texto of [cola, q.d || ""]) {
    const ks = Object.keys(LEYES).filter(k => LEYES[k].d.test(texto));
    if (ks.length === 1) return LEYES[ks[0]];
    if (ks.length > 1) return null;
  }
  const porTema = (POR_TEMA[bloque] || {})[q.tema];
  return porTema ? LEYES[porTema] : null;
}

function citar(texto, l) {
  // "Según el temario, …" · "Según el art. 41.2, …" · "Según la DT 8.ª, …"
  const m = texto.match(/^(¿?Según [^,¿?]+?)(,|\?)/);
  if (m) return m[1] + " " + deLa(l) + texto.slice(m[1].length);
  // "… según las tarjetas?" · "… según el temario …"
  const t = texto.match(/según (las tarjetas|el temario)/i);
  if (t) { const i = t.index + t[0].length; return texto.slice(0, i) + " " + deLa(l) + texto.slice(i); }
  // regla general: "Según <ley>, <enunciado>"
  const preg = texto.startsWith("¿"), cuerpo = preg ? texto.slice(1) : texto;
  const palabra = cuerpo.split(/[\s,:]/)[0];
  const min = !NO_MINUSCULA.has(palabra) && !/^[A-ZÁÉÍÓÚÑ0-9]{2,}$/.test(palabra);
  return `Según ${conArt(l)}, ${preg ? "¿" : ""}${min ? cuerpo[0].toLowerCase() + cuerpo.slice(1) : cuerpo}`;
}

const res = { yaCitan: 0, citadas: 0, enOpciones: 0, sinLey: 0 }, sinLey = [], enOpciones = [], cambios = [];
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort()) {
  const ruta = path.join(DIR, f), bruto = fs.readFileSync(ruta, "utf8");
  const eol = bruto.includes("\r\n") ? "\r\n" : "\n", finalNL = /\n$/.test(bruto);
  const v = JSON.parse(bruto.replace(/^﻿/, ""));
  const lista = Array.isArray(v) ? v : v.preguntas;
  let tocadas = 0;
  for (const q of lista) {
    const caso = CASOS[q.id];
    if (caso && caso.omitir) { res.sinLey++; sinLey.push(`${q.id} (a propósito: ${caso.omitir}) ${q.q}`); continue; }
    if (caso && caso.q) { if (q.q !== caso.q) { cambios.push([q.id, q.q, caso.q]); q.q = caso.q; tocadas++; res.citadas++; } else res.yaCitan++; continue; }
    if (CITA.test(q.q)) { res.yaCitan++; continue; }
    const l = leyDe(q, v.bloque || f.replace(/.json$/, "").replace(/^bloque-/, ""));
    if (!l) { res.sinLey++; sinLey.push(`${q.id} [${q.fuente || "sin fuente"}] ${q.q}`); continue; }
    if (q.o.some(o => (l.d && l.d.test(o)) || (l.f && l.f.test(o)) || NORMA_CONCRETA.test(o))) { res.enOpciones++; enOpciones.push(`${q.id} ${q.q}`); continue; }
    const nuevo = citar(q.q, l);
    cambios.push([q.id, q.q, nuevo]); q.q = nuevo; tocadas++; res.citadas++;
  }
  if (escribir && tocadas) {
    const salida = JSON.stringify(v, null, 1) + (finalNL ? "\n" : "");
    fs.writeFileSync(ruta, salida.replace(/\n/g, eol), "utf8");
  }
}

if (todo) cambios.forEach(([id, a, b]) => console.log(`${id}\n  antes: ${a}\n  ahora: ${b}`));
console.log(`\nYa citan la ley: ${res.yaCitan} · ${escribir ? "citadas ahora" : "se citarían"}: ${res.citadas} · ` +
  `la ley está en las opciones: ${res.enOpciones} · sin ley clara: ${res.sinLey}`);
if (sinLey.length) console.log(`\nSin ley clara (completa su "fuente" o añádelas a CASOS):\n  ` + sinLey.join("\n  "));
if (!escribir && res.citadas) console.log(`\nEs una prueba. Para aplicarlo: node tools/citar-ley.mjs --escribir`);
