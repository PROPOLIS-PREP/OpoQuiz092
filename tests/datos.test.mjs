// Tests de datos y de coherencia del build.  Ejecutar: node --test tests/
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

test("cada bloque con casillas en el tablero tiene preguntas de todos los niveles", () => {
  const enTablero = new Set(d.casillas.map(c => c.t).filter(t => d.categorias[t]));
  for (const b of enTablero)
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

test("las preguntas marcadas 'revisar' no llegan al juego", () => {
  assert.ok(d.activas.every(q => !q.revisar));
  assert.equal(d.activas.length, d.todas.filter(q => !q.revisar).length);
});

