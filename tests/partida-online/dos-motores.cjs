// Prueba de la partida online (subfase 3c) con DOS motores reales (index.html + online/partida.js), cada uno en su
// contexto, conectados a un servidor falso con las reglas de las funciones SQL. Reloj virtual compartido.
//
//   node tests/partida-online/dos-motores.cjs
//
// Escenarios:
//   1. Partidas completas 1 contra 1 con varias semillas: los dos motores aplican las mismas jugadas y terminan con
//      el mismo estado; report_result coincide y el servidor cierra como «completed» (nunca «disputed»).
//      Durante la partida, quien no responde nunca tiene en pantalla la pregunta abierta del rival.
//   2. Abandono a mitad de partida (leave_match): gana el rival y los dos motores se detienen.
//   3. Desconexión: el rival deja de enviar latidos; a los 60 s aparece «Reclamar victoria» y claim_forfeit da la victoria.
//   4. El modo local no escribe nada en el servidor ni necesita el puente (estado.online es null).
const path = require("path"), vm = require("vm");
const { crearEntorno, crearReloj, mulberry } = require("../motor-semilla/simulador.cjs");
const { crearServidor } = require("./servidor-falso.cjs");
const RAIZ = path.join(__dirname, "..", "..");
const HTML = path.join(RAIZ, "index.html"), PUENTE = path.join(RAIZ, "online", "partida.js");
const UA = "00000000-0000-0000-0000-0000000000a1", UB = "00000000-0000-0000-0000-0000000000b2";
const EPOCA = Date.parse("2026-11-26T10:00:00Z");
let fallos = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FALLO") + " " + m); if (!c) fallos++; };
const vaciar = () => new Promise(r => setImmediate(r));

function montar(semilla, turnos, semillaServidor) {
  const reloj = crearReloj();
  class FDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(EPOCA + reloj.ahora); }
    static now() { return EPOCA + reloj.ahora; }
  }
  const extra = () => ({ Date: FDate, CuentaOnline: { util: { esc: s => String(s) } } });
  const A = crearEntorno(HTML, { reloj, semillaRandom: 11, ctxExtra: extra(), scriptsExtra: [PUENTE] });
  const B = crearEntorno(HTML, { reloj, semillaRandom: 22, ctxExtra: extra(), scriptsExtra: [PUENTE] });
  const banco = JSON.parse(vm.runInContext("JSON.stringify(PREGUNTAS.map(q=>({b:q.b,n:q.n,q:q.q,o:q.o,a:q.a,d:q.d||''})))", A.ctx));
  const srv = crearServidor({ reloj, banco, jugadores: [UA, UB], turnos, semilla, semillaServidor, EPOCA });
  A.uid = UA; B.uid = UB; A.nom = "A"; B.nom = "B";
  return { reloj, A, B, srv };
}

const leer = (E, expr) => vm.runInContext(expr, E.ctx);
function estadoFinal(E) {
  return leer(E, `JSON.stringify({ronda:estado.ronda,j:estado.jugadores.map(j=>({p:j.puntos,cat:j.cat,m:j.meritos,a:j.aciertos,f:j.fallos,pos:j.pos,
    res:j.reserva,com:j.com,esc:j.escudos,racha:j.racha,doble:!!j.doble})),dest:estado.destacamentos})`);
}

// La «persona» de cada móvil: decide con su propio azar, solo cuando le toca a ella.
function crearPersona(E, srv, semilla, op = {}) {
  const rng = mulberry(semilla), hechas = {};
  return function actuar() {
    if (op.dormida) return false;
    if (!leer(E, "estado.activa")) return false;
    // 1. su pregunta abierta: quizá un comodín y, tras un rato, una respuesta (a veces fuera de plazo)
    const pa = leer(E, `preguntaActiva&&preguntaActiva.online?{mio:!preguntaActiva.p.remoto,resp:preguntaActiva.respondida,env:!!preguntaActiva.enviada,n:preguntaActiva.q.o.length,idx:preguntaActiva.idx}:null`);
    if (pa && pa.mio && !pa.resp && !pa.env && pa.n > 0 && !hechas["p" + pa.idx]) {
      hechas["p" + pa.idx] = true;
      const r = rng();
      if (r < 0.12) E.ctx.usarComodin("tiempo"); else if (r < 0.24) E.ctx.usarComodin("mitad"); else if (r < 0.32) E.ctx.usarComodin("sirena");
      const q = srv.S.qs[pa.idx].q, retraso = 800 + Math.floor(rng() * (rng() < 0.1 ? 40000 : 20000));
      const bien = rng() < 0.6;
      E.reloj.setTimeout(() => {
        const fuera = leer(E, "preguntaActiva&&preguntaActiva.fuera?preguntaActiva.fuera.slice():[]");
        const malas = q.o.map((_, k) => k).filter(k => k !== q.a && !fuera.includes(k));
        E.ctx.responderOnline(bien || !malas.length ? q.a : malas[Math.floor(rng() * malas.length)]);
      }, retraso);
      return true;
    }
    // 2. «Continuar» de la revisión de la pregunta
    const seguir = E.porIdGet("preg-seguir");
    if (E.porIdGet("velo-preg").classList.contains("on") && seguir.onclick && /preg-seguir/.test(E.porIdGet("preg-pie").innerHTML) && rng() < 0.7) {
      E.porIdGet("preg-pie").innerHTML = ""; seguir.onclick(); return true;
    }
    // 3. carta abierta: botones, o elección en la lista (comisaría, lanzar, recolocar)
    const velo = E.porIdGet("velo-carta"), pie = E.porIdGet("carta-pie"), extraC = E.porIdGet("carta-extra");
    if (velo.classList.contains("on")) {
      const mio = leer(E, "jugActual()===jugYo()");
      const tipo = velo.firstElementChild.className;
      if (mio && extraC.onclick && !hechas["x" + leer(E, "estado.ronda+':'+estado.turno+':'+jugYo().pos")] && (tipo.includes("tienda") ? rng() < 0.5 : true)) {
        const k = leer(E, "estado.ronda+':'+estado.turno+':'+jugYo().pos"); hechas["x" + k] = true;
        const rival = leer(E, "estado.jugadores.find(j=>j!==jugYo()).id");
        const mios = leer(E, "Object.entries(estado.destacamentos).filter(([i,d])=>d.jug===jugYo().id).map(([i])=>+i)");
        const libre = leer(E, "!estado.destacamentos[jugYo().pos]&&!ESQUINAS.includes(TABLERO[jugYo().pos].t)");
        const art = { dataset: { id: String(rival), i: String(Math.floor(rng() * 3)) }, disabled: false };
        const mv = mios.length && libre && rng() < 0.5 ? { dataset: { mv: String(mios[0]) }, disabled: false } : null;
        const rt = !mv && mios.length ? { dataset: { rt: String(mios[0]) } } : null;
        extraC.onclick({ target: { closest: s => s === ".art" ? art : s === "[data-mv]" ? mv : s === "[data-rt]" ? rt : null } });
        return true;
      }
      const bs = pie.children.filter(x => !x.disabled && x.onclick);
      if (bs.length) { const b = bs[Math.floor(rng() * bs.length)]; b.onclick(); return true; }
    }
    // 4. despliegue propio: a veces coloca un efectivo antes de terminar
    if (leer(E, "estado.fase==='despliegue'&&jugActual()===jugYo()") && rng() < 0.6) {
      const u = leer(E, "(()=>{const o=unidadesDe(jugYo())[0];const c=casillasLibres();return o&&c.length?[o.t,c[0]]:null})()");
      if (u && !hechas["d" + u.join(":") + leer(E, "estado.ronda")]) { hechas["d" + u.join(":") + leer(E, "estado.ronda")] = true; E.ctx.intentarDespliegue(u[0], u[1]); return true; }
    }
    // 5. botón de acción (Responder, Tirar dado, Terminar despliegue)
    const b = E.porIdGet("btn-accion");
    if (!b.disabled && b.onclick) { b.onclick(); return true; }
    return false;
  };
}

async function jugar({ semilla, turnos = 5, semillaServidor = 7, abandonaB = null, desconectaB = null, limite = 400000, preparar = null, trampaB = null }) {
  const { reloj, A, B, srv } = montar(semilla, turnos, semillaServidor);
  await A.ctx.PartidaOnline.entrar(srv.cliente(UA), "M1", UA);
  await B.ctx.PartidaOnline.entrar(srv.cliente(UB), "M1", UB);
  // mismo ajuste en los dos motores antes de la primera jugada (para probar despliegue, comisaría y sirena)
  if (preparar) { vm.runInContext(preparar, A.ctx); vm.runInContext(preparar, B.ctx); }
  // control negativo: un cambio solo en B (los motores deben dejar de coincidir y notarse)
  if (trampaB) vm.runInContext(trampaB, B.ctx);
  const roto = E => { const a = E.ctx.PartidaOnline.actual(); return !!(a && a.puente._estado.roto); };
  const PERFIL = "JSON.stringify({m:perfil.monedas,t:perfil.trofeos,e:perfil.estrellas,s:perfil.sobres,st:perfil.stats,d:perfil.diario.prog,tp:perfil.temp.prog,liga:perfil.liga&&perfil.liga.pts,g:perfil.grupo})";
  const perfilAntes = { A: leer(A, PERFIL), B: leer(B, PERFIL) };
  const personaB = { dormida: false };
  const actA = crearPersona(A, srv, semilla * 3 + 1), actB = crearPersona(B, srv, semilla * 5 + 2, personaB);
  let pasos = 0, vistaAjena = 0, reclamado = false;
  while (pasos < limite) {
    await vaciar();
    const acabado = srv.S.status === "finished" && !A.ctx.PartidaOnline.actual() && (!B.ctx.PartidaOnline.actual() || desconectaB);
    if (acabado) break;
    if (roto(A) || roto(B)) break;
    // quien no responde no ve la pregunta abierta del rival
    const cur = srv.S.current != null ? srv.S.qs[srv.S.current] : null;
    if (cur && !cur.closed) {
      const otro = cur.player === UA ? B : A;
      if (otro.porIdGet("velo-preg").classList.contains("on") && otro.porIdGet("preg-texto").textContent === cur.q.q) vistaAjena++;
    }
    if (abandonaB != null && srv.S.log.length >= abandonaB && srv.S.status === "in_progress" && !personaB.dormida) {
      personaB.dormida = true; B.ctx.eval ? 0 : 0; vm.runInContext("estado.online.abandonar()", B.ctx);
    }
    if (desconectaB != null && srv.S.log.length >= desconectaB && !personaB.dormida) {
      personaB.dormida = true; B.ctx.PartidaOnline.actual().puente.parar();   // sin latidos ni sondeo: como si cerrara la app
    }
    if (desconectaB != null && personaB.dormida && !reclamado && /online-reclamar/.test(A.porIdGet("online-barra").innerHTML)) {
      reclamado = true; A.porIdGet("online-reclamar").onclick(); continue;
    }
    if (reloj.hayTimeouts()) { reloj.paso(); pasos++; continue; }
    if (actA() || actB()) continue;
    if (reloj.paso()) { pasos++; continue; }
    break;
  }
  const perfilIntacto = leer(A, PERFIL) === perfilAntes.A && leer(B, PERFIL) === perfilAntes.B;
  return { A, B, srv, pasos, vistaAjena, reclamado, reloj, rotoA: roto(A), rotoB: roto(B), perfilIntacto };
}

if (require.main !== module) { module.exports = { jugar, estadoFinal, leer }; return; }
(async () => {
  // ── 1. partidas completas
  console.log("── 1. Partidas completas 1 contra 1 (dos motores, servidor falso)");
  const semillas = [101, 202, 303, 404, 505, 606];
  let iguales = 0, cerradas = 0, sinVista = 0, sumaJugadas = 0, conPreguntas = 0, perfilesIntactos = 0;
  const tipos = new Set();
  for (const s of semillas) {
    const r = await jugar({ semilla: s, turnos: 5, semillaServidor: s + 9 });
    const fa = estadoFinal(r.A), fb = estadoFinal(r.B);
    const dA = r.A.traza.length ? 0 : 0;
    const tA = leer(r.A, "JSON.stringify(__traza.filter(t=>/^(dado|ruleta|fin)/.test(t)))"), tB = leer(r.B, "JSON.stringify(__traza.filter(t=>/^(dado|ruleta|fin)/.test(t)))");
    r.srv.S.log.forEach(a => tipos.add(a.kind));
    sumaJugadas += r.srv.S.log.length;
    if (Object.keys(r.srv.S.qs).length >= 8) conPreguntas++;
    const igual = fa === fb && tA === tB;
    if (igual) iguales++; else console.log(`   semilla ${s}: estado ${fa === fb ? "=" : "≠"} · trazas ${tA === tB ? "=" : "≠"}\n     A ${fa.slice(0, 300)}\n     B ${fb.slice(0, 300)}`);
    if (r.srv.S.status === "finished" && r.srv.S.motivo === "completed") cerradas++;
    else console.log(`   semilla ${s}: servidor ${r.srv.S.status} ${r.srv.S.motivo} · pasos ${r.pasos} · jugadas ${r.srv.S.log.length} · fase A ${leer(r.A, "estado.fase")} B ${leer(r.B, "estado.fase")}`);
    if (r.vistaAjena === 0) sinVista++;
    if (r.perfilIntacto) perfilesIntactos++; else console.log(`   semilla ${s}: el perfil local cambió durante la partida online`);
  }
  ok(iguales === semillas.length, `mismo estado final y mismas trazas (dado, ruleta, fin) en los dos móviles: ${iguales}/${semillas.length}`);
  ok(cerradas === semillas.length, `report_result coincide y el servidor cierra como completed (nunca disputed): ${cerradas}/${semillas.length}`);
  ok(sinVista === semillas.length, `quien no responde nunca tiene en pantalla la pregunta abierta del rival: ${sinVista}/${semillas.length}`);
  ok(conPreguntas === semillas.length, `cada partida reparte al menos 8 preguntas del servidor: ${conPreguntas}/${semillas.length}`);
  ok(perfilesIntactos === semillas.length, `el perfil local no cambia (monedas, trofeos, estrellas, sobres, estadísticas, retos, liga): ${perfilesIntactos}/${semillas.length}`);
  const esperadas = ["inicio", "tirar", "pregunta", "resultado", "fin"];
  ok(esperadas.every(t => tipos.has(t)), `jugadas vistas en el registro: ${[...tipos].sort().join(", ")} (media ${Math.round(sumaJugadas / semillas.length)} por partida)`);

  // ── 1b. partidas largas con efectivos y sirenas desde el principio (despliegue, comisaría, recolocar, sirena)
  console.log("── 1b. Partidas largas (15 turnos) con efectivos y una sirena para cada uno");
  const tiposL = new Set();
  let igualesL = 0, cerradasL = 0;
  const largas = [11, 12, 13, 14, 16];   // la 16 incluye una carta «recolocar»
  for (const s of largas) {
    const r = await jugar({ semilla: s, turnos: 15, semillaServidor: s, preparar: "estado.jugadores.forEach(j=>{j.reserva[1]+=3;j.reserva[0]+=4;j.com.sirena+=1;j.puntos+=400})" });
    r.srv.S.log.forEach(a => tiposL.add(a.kind));
    if (estadoFinal(r.A) === estadoFinal(r.B)) igualesL++; else console.log(`   semilla ${s}: estados distintos`);
    if (r.srv.S.motivo === "completed") cerradasL++; else console.log(`   semilla ${s}: servidor ${r.srv.S.status} ${r.srv.S.motivo} · fase A ${leer(r.A, "estado.fase")} B ${leer(r.B, "estado.fase")}`);
  }
  ok(igualesL === largas.length && cerradasL === largas.length, `mismo estado final y cierre completed: ${igualesL}/${largas.length} y ${cerradasL}/${largas.length}`);
  const todas = new Set([...tipos, ...tiposL]);
  const acciones = ["tirar", "desplegar", "fin_despliegue", "examen", "distrito", "comprar", "fin_comisaria", "lanzar", "recolocar", "sirena", "comodin", "pregunta", "resultado"];
  const faltan = acciones.filter(t => !todas.has(t));
  ok(!faltan.length, `jugadas probadas: ${acciones.filter(t => todas.has(t)).join(", ")}${faltan.length ? " · sin probar: " + faltan.join(", ") : ""}`);

  // ── 2. abandono
  console.log("── 2. Abandono a mitad de partida");
  const ab = await jugar({ semilla: 777, turnos: 5, abandonaB: 25 });
  ok(ab.srv.S.status === "finished" && ab.srv.S.motivo === "forfeit" && ab.srv.S.ganador === UA, `leave_match de B: gana A por abandono (${ab.srv.S.motivo}, ganador ${ab.srv.S.ganador === UA ? "A" : ab.srv.S.ganador})`);
  ok(!leer(ab.A, "estado.activa") && !leer(ab.B, "estado.activa"), "los dos motores se detienen");
  ok(/abandono/.test(ab.A.porIdGet("ganador").textContent) || /abandon/.test(ab.A.porIdGet("online-cierre").textContent), `A ve el final por abandono: «${ab.A.porIdGet("ganador").textContent}» · «${ab.A.porIdGet("online-cierre").textContent}»`);

  // ── 3. desconexión y «Reclamar victoria»
  console.log("── 3. Desconexión del rival y Reclamar victoria");
  const dc = await jugar({ semilla: 888, turnos: 5, desconectaB: 15 });
  ok(dc.reclamado, "a los 60 s sin latido de B aparece «Reclamar victoria» en el móvil de A");
  ok(dc.srv.S.status === "finished" && dc.srv.S.motivo === "forfeit" && dc.srv.S.ganador === UA, `claim_forfeit: gana A (${dc.srv.S.motivo})`);
  const intentos = dc.srv.S.llamadas.filter(l => l === UA.slice(-1) + ":claim_forfeit").length;
  ok(intentos === 1, `claim_forfeit se llamó ${intentos} vez, solo al pulsar el botón (nada automático)`);

  // ── 3b. control negativo: B juega con otra semilla
  console.log("── 3b. Control negativo: el motor B recibe otra semilla a escondidas");
  // Lo que se exige: una partida desincronizada NUNCA se cierra como «completed» con un resultado falso.
  // Puede notarse de tres formas: el motor detecta una jugada que no esperaba (se detiene), el servidor recibe
  // resultados distintos (disputed), o los dos motores se quedan esperándose (bloqueo: en la app, «tu rival lleva
  // tiempo sin jugar»; el tratamiento del jugador inactivo queda para la 3d).
  let sinResultadoFalso = 0;
  for (const s of [31, 32, 33]) {
    const r = await jugar({ semilla: s, turnos: 5, trampaB: "fijarSemilla(424242)", limite: 60000 });
    const falso = r.srv.S.motivo === "completed" && estadoFinal(r.A) !== estadoFinal(r.B);
    if (!falso && !(r.srv.S.motivo === "completed" && estadoFinal(r.A) === estadoFinal(r.B))) sinResultadoFalso++;
    console.log(`   semilla ${s}: ${r.rotoA || r.rotoB ? "el motor detecta una jugada inesperada y se detiene" : r.srv.S.motivo === "disputed" ? "resultados distintos: disputed" : r.srv.S.status === "in_progress" ? "bloqueo: cada motor espera al otro (aviso de rival inactivo)" : "cerrada " + r.srv.S.motivo}`);
  }
  ok(sinResultadoFalso === 3, `una semilla distinta en un móvil nunca acaba en un resultado falso «completed»: ${sinResultadoFalso}/3`);

  // ── 4. modo local intacto
  console.log("── 4. Modo local");
  const L = crearEntorno(HTML, { semillaRandom: 5, scriptsExtra: [PUENTE], ctxExtra: { CuentaOnline: { util: { esc: s => String(s) } } } });
  vm.runInContext(`cfg.nJug=2;cfg.rondas=2;cfg.modo="puntos";iniciar("rapida");`, L.ctx);
  ok(leer(L, "estado.online===null&&estado.yo===0&&jugYo()===estado.jugadores[0]&&estado.jugadores[1].bot&&!estado.jugadores[1].remoto"), "partida local: estado.online null, jugYo() es el jugador 0 y los rivales son bots");

  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.stack || e); process.exit(1); });
