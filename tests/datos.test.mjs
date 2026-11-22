// Tests de datos y de coherencia del build.  Ejecutar: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { RAIZ, cargarTodo, NIVELES } from "../tools/lib/datos.mjs";

const d = cargarTodo();

test("data/ no tiene errores de validación", () => {
  assert.deepEqual(d.errores, []);
});

test("index.html está al día con data/", () => {
  execFileSync(process.execPath, [path.join(RAIZ, "tools", "build.mjs"), "--check"], { stdio: "pipe" });
});

test("el tablero tiene 28 casillas y una sola salida y un solo juzgado", () => {
  assert.equal(d.casillas.length, 28);
  assert.equal(d.casillas[0].t, "salida");
  assert.equal(d.casillas.filter(c => c.t === "juzgado").length, 1);
});

test("la ruleta tiene los seis bloques del temario y cada uno tiene 2 casillas en el tablero", () => {
  assert.deepEqual(Object.keys(d.categorias), ["legislativo", "policial", "trafico", "penal", "ordenanzas", "social"]);
  for (const b of Object.keys(d.categorias))
    assert.equal(d.casillas.filter(c => c.t === b).length, 2, `${b} no tiene 2 casillas`);
});

test("cada bloque que ya tiene preguntas las tiene de todos los niveles", () => {
  const conPreguntas = new Set(d.activas.map(q => q.b));
  assert.ok(conPreguntas.size > 0);
  for (const b of conPreguntas)
    for (let n = 1; n <= NIVELES; n++)
      assert.ok(d.activas.some(q => q.b === b && q.n === n), `${b} sin preguntas de nivel ${n}`);
});

test("el escalafón sube: multiplicador y méritos requeridos crecientes", () => {
  for (let i = 1; i < d.escalafon.length; i++) {
    assert.ok(d.escalafon[i].m > d.escalafon[i - 1].m);
    assert.ok(d.escalafon[i].req > d.escalafon[i - 1].req);
  }
});

// Partida simulada sobre los datos: sortea preguntas como el juego (bloque + nivel)
// durante muchas partidas y comprueba que siempre hay pregunta válida.
test("partidas simuladas: nunca falta pregunta para ningún bloque y nivel", () => {
  const bloques = [...new Set(d.activas.map(q => q.b))];
  const P = d.activas;
  for (let partida = 0; partida < 200; partida++) {
    const usadas = new Set();
    for (let turno = 0; turno < 20 * 5 * 3; turno++) {
      const b = bloques[Math.floor(Math.random() * bloques.length)];
      const n = 1 + Math.floor(Math.random() * NIVELES);
      let pool = P.filter((q, i) => q.n === n && !usadas.has(i));
      for (const delta of [1, 2]) if (!pool.length) pool = P.filter((q, i) => Math.abs(q.n - n) <= delta && !usadas.has(i));
      if (!pool.length) { usadas.clear(); pool = P.filter(q => q.n === n); }
      if (!pool.length) pool = P;
      const f = pool.filter(q => q.b === b); if (f.length) pool = f;
      const q = pool[Math.floor(Math.random() * pool.length)];
      assert.ok(q && q.o.length >= 3 && q.o.length <= 4 && q.a >= 0 && q.a < q.o.length);
      usadas.add(P.indexOf(q));
    }
  }
});

test("cada 'gemela' apunta a una pregunta que existe y del mismo bloque", () => {
  const porId = new Map(d.todas.map(q => [q.id, q]));
  for (const q of d.todas.filter(q => q.gemela)) {
    assert.ok(porId.has(q.gemela), `${q.id}: gemela ${q.gemela} no existe`);
    assert.equal(porId.get(q.gemela).b, q.b, `${q.id}: su gemela es de otro bloque`);
  }
});

test("las preguntas marcadas 'revisar' no llegan al juego", () => {
  assert.ok(d.activas.every(q => !q.revisar));
  assert.equal(d.activas.length, d.todas.filter(q => !q.revisar).length);
});


// Avatar: cada pieza del catálogo de la taquilla (ACC en index.html) debe tener su imagen.
test("cada pieza del avatar tiene imagen", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
  const m = html.match(/const ACC=(\{[\s\S]*?\n\});/);
  assert.ok(m, "no encuentro el catálogo ACC");
  const ACC = new Function("return " + m[1])();
  const web = path.join(RAIZ, "assets", "avatar", "web");
  const faltan = Object.entries(ACC)
    .filter(([k, a]) => ["agente", "fondo", "gorra", "extra", "marco", "base"].includes(a.s) && k !== "nada")
    .filter(([k]) => !fs.existsSync(path.join(web, k + ".webp"))).map(([k]) => k);
  assert.deepEqual(faltan, []);
  const { agentes } = JSON.parse(fs.readFileSync(path.join(RAIZ, "data", "avatar.json"), "utf8"));
  const gorras = Object.keys(ACC).filter(k => ACC[k].s === "gorra").sort();
  for (const [agente, { retratos }] of Object.entries(agentes)) {
    assert.deepEqual(Object.keys(retratos).sort(), gorras, agente);
    assert.equal(new Set(Object.values(retratos)).size, gorras.length, agente);
    for (const id of Object.values(retratos)) assert.ok(fs.existsSync(path.join(web, id + ".webp")), id);
  }
});
