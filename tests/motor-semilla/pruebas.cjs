// Pruebas del motor con semilla (subfase 3b). Ver README.md.
//   node tests/motor-semilla/pruebas.cjs                     compara el index.html de REF_BASE con el actual
//   node tests/motor-semilla/pruebas.cjs --base <commit>     compara con el index.html de otro commit
//   node tests/motor-semilla/pruebas.cjs <antes.html> <despues.html>
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const { simular } = require("./simulador.cjs");
// último commit ANTES de la 3b: el motor con Math.random directo (referencia de la prueba A)
const REF_BASE = "e93fb6d";
const RAIZ = path.join(__dirname, "..", "..");
let [antes, despues] = process.argv.slice(2);
if (!antes || antes === "--base") {
  const ref = antes === "--base" && despues ? despues : REF_BASE;
  antes = path.join(os.tmpdir(), `patrullan2-index-${ref}.html`);
  fs.writeFileSync(antes, execFileSync("git", ["show", `${ref}:index.html`], { cwd: RAIZ, maxBuffer: 1 << 30 }));
  despues = path.join(RAIZ, "index.html");
  console.log(`Referencia: index.html de ${ref} · actual: index.html del árbol de trabajo`);
}
let fallos = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FALLO") + " " + m); if (!c) fallos++; };
// las llamadas anónimas llevan número de línea, que cambia al añadir líneas: se normalizan
const norm = ls => ls.map(x => /:\d+:\d+\)?$/.test(x) ? "anónima" : x);
const DECISION = ["tirar", "preguntaDeTurno", "nivelAzar", "sortearNivel", "sacarPesada", "azarJugador", "cartaSancion", "elegirPregunta",
  "faseDespliegue", "ofrecerExamen", "servicioDistrito", "accionRecolocar", "turnoBot"];

// ── Prueba A: equivalencia del modo local (mismo Math.random → mismas decisiones y mismas llamadas)
console.log("── Prueba A: equivalencia del modo local (20 semillas, partidas de 6 rondas y 4 bots)");
let iguales = 0, total = 0;
for (let s = 1; s <= 20; s++) {
  const a = simular(antes, { semillaRandom: s * 7919 }), b = simular(despues, { semillaRandom: s * 7919 });
  total++;
  const mismaTraza = JSON.stringify(a.traza.concat(a.clics)) === JSON.stringify(b.traza.concat(b.clics));
  const mismasLlamadas = JSON.stringify(norm(a.llamadas)) === JSON.stringify(norm(b.llamadas));
  const mismoFinal = JSON.stringify(a.final) === JSON.stringify(b.final);
  const terminada = a.final.pantalla === "fin" && b.final.pantalla === "fin" && !a.atascos && !b.atascos;
  if (mismaTraza && mismasLlamadas && mismoFinal && terminada) iguales++;
  else console.log(`   semilla ${s}: traza ${mismaTraza ? "=" : "≠"} · llamadas ${mismasLlamadas ? "=" : "≠"} (${a.llamadas.length}/${b.llamadas.length}) · final ${mismoFinal ? "=" : "≠"} · terminadas ${terminada}`);
  if (s === 1) console.log(`   (ejemplo semilla 1: ${a.traza.length} decisiones, ${a.clics.length} clics, ${a.llamadas.length} llamadas a Math.random, ronda final ${a.final.ronda})`);
}
ok(iguales === total, `trazas, secuencia de llamadas y resultado final idénticos antes y después: ${iguales}/${total}`);

// ── Prueba B: determinismo con semilla (lo que necesitará una partida online)
console.log("── Prueba B: determinismo con fijarSemilla (vía iniciar(modo, {semilla}))");
let deterministas = 0, sinDecisionesEnRandom = 0;
const trazas = new Set();
const SEMILLAS = [12345, 987654321, 4242, 2026112500, 7];
for (const S of SEMILLAS) {
  const x = simular(despues, { semillaRandom: 1, semillaJuego: S, esperaBotFija: true }), y = simular(despues, { semillaRandom: 999, semillaJuego: S, esperaBotFija: true });
  const tx = JSON.stringify(x.traza), ty = JSON.stringify(y.traza);
  const visualesDistintos = JSON.stringify(x.llamadas) !== "" && x.llamadas.length > 0;
  if (tx === ty && JSON.stringify(x.final) === JSON.stringify(y.final) && x.final.pantalla === "fin" && visualesDistintos) deterministas++;
  else console.log(`   semilla ${S}: traza ${tx === ty ? "=" : "≠"} · final ${JSON.stringify(x.final) === JSON.stringify(y.final) ? "=" : "≠"}`);
  // con semilla, ninguna función de decisión debe tocar Math.random (todas usan rngJuego)
  const intrusas = [...new Set(x.llamadas.concat(y.llamadas))].filter(f => DECISION.includes(f) && f !== "turnoBot");
  const turnoBotRand = x.llamadas.filter(f => f === "turnoBot").length, preguntasBot = x.traza.filter(t => t.startsWith("responde")).length;
  if (!intrusas.length && turnoBotRand <= preguntasBot) sinDecisionesEnRandom++;
  else console.log(`   semilla ${S}: decisiones que aún usan Math.random: ${intrusas.join(", ")} · turnoBot ${turnoBotRand} (solo debería ser el tiempo de espera)`);
  trazas.add(tx);
}
ok(deterministas === SEMILLAS.length, `misma semilla y Math.random distinto → misma traza y mismo final: ${deterministas}/${SEMILLAS.length}`);
ok(sinDecisionesEnRandom === SEMILLAS.length, `con semilla, las decisiones no llaman a Math.random (turnoBot solo para el tiempo de espera): ${sinDecisionesEnRandom}/${SEMILLAS.length}`);
ok(trazas.size === SEMILLAS.length, `semillas distintas → trazas distintas: ${trazas.size}/${SEMILLAS.length}`);
const conSemilla = simular(despues, { semillaRandom: 3, semillaJuego: 12345 }), sinSemilla = simular(despues, { semillaRandom: 3 });
ok(JSON.stringify(conSemilla.traza) !== JSON.stringify(sinSemilla.traza) && sinSemilla.final.pantalla === "fin", "después de una partida con semilla, una local (sin semilla) vuelve a Math.random");

// ── Prueba C: revisión del código
console.log("── Prueba C: revisión del código");
const src = fs.readFileSync(despues, "utf8");
function cuerpo(nombre) {
  let i = src.indexOf("function " + nombre + "(");
  if (i < 0) { i = src.indexOf("const " + nombre + "="); return src.slice(i, src.indexOf("\n", i)); }
  let j = src.indexOf("{", i), prof = 0;
  for (let k = j; k < src.length; k++) { if (src[k] === "{") prof++; else if (src[k] === "}" && --prof === 0) return src.slice(i, k + 1); }
}
const malas = [];
for (const f of DECISION) {
  const c = cuerpo(f);
  if (!c) { malas.push(f + " (no encontrada)"); continue; }
  const sinComent = c.replace(/\/\*[\s\S]*?\*\//g, "");
  const rnd = (sinComent.match(/Math\.random/g) || []).length, azarViejo = /[^\w.](azar|barajar)\(/.test(sinComent);
  if (f === "turnoBot") { if (rnd !== 1 || !/espera=.*Math\.random/.test(sinComent) || azarViejo) malas.push(f); }
  else if (rnd || azarViejo) malas.push(f);
}
ok(!malas.length, "ninguna función de decisión usa Math.random, azar() ni barajar() (turnoBot solo para el tiempo de espera)" + (malas.length ? ": " + malas.join(", ") : ""));
ok(/indicesFalsos\(q\)\.sort\(\(\)=>Math\.random\(\)-\.5\)/.test(cuerpo("descartarDos")), "descartarDos (50/50) sigue con Math.random");
ok(/sacarPesada\(CROMOS\.map\([^)]*\)[^)]*\),Math\.random\)/.test(src), "el álbum llama a sacarPesada con Math.random");
for (const f of ["confeti", "generarLiga", "avAzar", "perfilNuevo", "addAmigo"]) {
  const a = (fs.readFileSync(antes, "utf8").match(new RegExp("function " + f + "\\([\\s\\S]*?\\n}")) || [""])[0];
  const b = (src.match(new RegExp("function " + f + "\\([\\s\\S]*?\\n}")) || [""])[0];
  ok(a && a === b, `${f} sin cambios`);
}
console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
