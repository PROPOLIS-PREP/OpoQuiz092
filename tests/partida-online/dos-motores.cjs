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

function montar(semilla, turnos, semillaServidor, conInactividad = true) {
  const reloj = crearReloj();
  class FDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(EPOCA + reloj.ahora); }
    static now() { return EPOCA + reloj.ahora; }
  }
  const extra = () => ({ Date: FDate, CuentaOnline: { util: { esc: s => String(s) } } });
  const A = crearEntorno(HTML, { reloj, semillaRandom: 11, ctxExtra: extra(), scriptsExtra: [PUENTE] });
  const B = crearEntorno(HTML, { reloj, semillaRandom: 22, ctxExtra: extra(), scriptsExtra: [PUENTE] });
  const banco = JSON.parse(vm.runInContext("JSON.stringify(PREGUNTAS.map(q=>({b:q.b,n:q.n,q:q.q,o:q.o,a:q.a,d:q.d||''})))", A.ctx));
  const srv = crearServidor({ reloj, banco, jugadores: [UA, UB], turnos, semilla, semillaServidor, EPOCA, conInactividad });
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
      const q = srv.S.qs[pa.idx].q, retraso = op.rapida ? 800 + Math.floor(rng() * 1500) : 800 + Math.floor(rng() * (rng() < 0.1 ? 40000 : 20000));
      const bien = rng() < 0.6;
      E.reloj.setTimeout(() => {
        const fuera = leer(E, "preguntaActiva&&preguntaActiva.fuera?preguntaActiva.fuera.slice():[]");
        const malas = q.o.map((_, k) => k).filter(k => k !== q.a && !fuera.includes(k));
        E.ctx.PartidaOnline.actividad();   // tocar una opción cuenta como actividad
        E.ctx.responderOnline(bien || !malas.length ? q.a : malas[Math.floor(rng() * malas.length)]);
      }, retraso);
      return true;
    }
    // 2. «Continuar» de la revisión de la pregunta
    const seguir = E.porIdGet("preg-seguir");
    // con soloSuyo, como una persona real, no toca la revisión de la pregunta del rival (se cierra sola)
    const revAjena = op.soloSuyo && leer(E, "!!(preguntaActiva&&preguntaActiva.p.remoto)");
    if (!revAjena && E.porIdGet("velo-preg").classList.contains("on") && seguir.onclick && /preg-seguir/.test(E.porIdGet("preg-pie").innerHTML) && rng() < 0.7) {
      E.porIdGet("preg-pie").innerHTML = ""; seguir.onclick(); return true;
    }
    // 3. carta abierta: botones, o elección en la lista (comisaría, lanzar, recolocar)
    const velo = E.porIdGet("velo-carta"), pie = E.porIdGet("carta-pie"), extraC = E.porIdGet("carta-extra");
    if (velo.classList.contains("on")) {
      const mio = leer(E, "jugActual()===jugYo()||document.getElementById('velo-carta').dataset.mia==='1'");
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
      const bs = op.soloSuyo && !mio ? [] : pie.children.filter(x => !x.disabled && x.onclick);
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

async function jugar({ semilla, turnos = 5, semillaServidor = 7, abandonaB = null, desconectaB = null, limite = 400000, preparar = null, trampaB = null, inactivoB = null, conInactividad = true, sinToques = false, personas = {}, tableroB = null }) {
  const { reloj, A, B, srv } = montar(semilla, turnos, semillaServidor, conInactividad);
  const ina = { aviso5: false, oculto: false, cancelado: false, reclamado: false, botonA: false };
  // tableroB: en su turno, B deja de pulsar botones y solo mueve el tablero (arrastrar, ampliar, tocar zonas vacías);
  // con clicA (ms) pulsa un botón de acción a ese tiempo; con despertarA (ms) vuelve a jugar con normalidad
  const tb = tableroB ? { ini: null, ultimo: 0, gestos: 0, clic: false, despierto: false, aviso: false, avisoEn: null, perdioEn: null } : null;
  await A.ctx.PartidaOnline.entrar(srv.cliente(UA), "M1", UA);
  await B.ctx.PartidaOnline.entrar(srv.cliente(UB), "M1", UB);
  // mismo ajuste en los dos motores antes de la primera jugada (para probar despliegue, comisaría y sirena)
  if (preparar) { vm.runInContext(preparar, A.ctx); vm.runInContext(preparar, B.ctx); }
  // control negativo: un cambio solo en B (los motores deben dejar de coincidir y notarse)
  if (trampaB) vm.runInContext(trampaB, B.ctx);
  // sin toques: «tocar» solo renueva el reloj local (no salta la cuenta atrás) y no envía nada al servidor;
  // así todo lo que recibe mark_activity son latidos y avisos de cambio
  if (sinToques) for (const E of [A, B]) E.ctx.PartidaOnline.actividad = () => vm.runInContext("PartidaOnline._act.local = Date.now()", E.ctx);
  const roto = E => { const a = E.ctx.PartidaOnline.actual(); return !!(a && a.puente._estado.roto); };
  const PERFIL = "JSON.stringify({m:perfil.monedas,t:perfil.trofeos,e:perfil.estrellas,s:perfil.sobres,st:perfil.stats,d:perfil.diario.prog,tp:perfil.temp.prog,liga:perfil.liga&&perfil.liga.pts,g:perfil.grupo})";
  const perfilAntes = { A: leer(A, PERFIL), B: leer(B, PERFIL) };
  const personaB = { dormida: false, ...personas };
  const actA = crearPersona(A, srv, semilla * 3 + 1, { ...personas }), actB = crearPersona(B, srv, semilla * 5 + 2, personaB);
  let pasos = 0, reclamado = false, malVista = 0;
  const vistas = new Set(), intentadas = new Set();
  while (pasos < limite) {
    await vaciar();
    const acabado = srv.S.status === "finished" && !A.ctx.PartidaOnline.actual() && (!B.ctx.PartidaOnline.actual() || desconectaB);
    if (acabado) break;
    if (roto(A) || roto(B)) break;
    // quien no responde ve la misma pregunta en solo lectura, sin la opción correcta, y no puede responderla
    const cur = srv.S.current != null ? srv.S.qs[srv.S.current] : null;
    if (cur && !cur.closed) {
      const otro = cur.player === UA ? B : A;
      if (otro.porIdGet("velo-preg").classList.contains("on") && otro.porIdGet("preg-texto").textContent === cur.q.q) {
        vistas.add(srv.S.current);
        const v = leer(otro, "preguntaActiva?{a:preguntaActiva.q.a,o:JSON.stringify(preguntaActiva.q.o),rem:!!preguntaActiva.p.remoto,pie:document.getElementById('preg-pie').innerHTML}:null");
        if (!v || v.a !== -1 || v.o !== JSON.stringify(cur.q.o) || !v.rem || !/<b>agente_00(a1|b2)<\/b> está respondiendo…/.test(v.pie)) malVista++;
        if (!intentadas.has(srv.S.current)) { intentadas.add(srv.S.current); otro.ctx.responderOnline(cur.q.a); }   // intenta responder: no debe salir nada
      }
    }
    if (abandonaB != null && srv.S.log.length >= abandonaB && srv.S.status === "in_progress" && !personaB.dormida) {
      personaB.dormida = true; B.ctx.eval ? 0 : 0; vm.runInContext("estado.online.abandonar()", B.ctx);
    }
    if (desconectaB != null && srv.S.log.length >= desconectaB && !personaB.dormida) {
      personaB.dormida = true; B.ctx.PartidaOnline._act.autoPerder = false; B.ctx.PartidaOnline.actual().puente.parar();   // sin latidos ni sondeo: como si cerrara la app
    }
    if (desconectaB != null && personaB.dormida && !reclamado && /online-reclamar/.test(A.porIdGet("online-barra").innerHTML)) {
      reclamado = true; A.porIdGet("online-reclamar").onclick(); continue;
    }
    if (tb && !tb.despierto) {
      const P = B.ctx.PartidaOnline;
      if (tb.ini == null && srv.S.status === "in_progress" && srv.S.log.length >= tableroB.desde && P.actual() && P._necesitoActuar()) {
        tb.ini = reloj.ahora; tb.ultimo = reloj.ahora; personaB.dormida = true; P._act.autoPerder = true;
      }
      if (tb.ini != null) {
        const pasado = reloj.ahora - tb.ini, nada = { closest: () => null };
        if (reloj.ahora - tb.ultimo >= 2000) {               // arrastra, amplía y toca el tablero cada 2 s
          tb.ultimo = reloj.ahora; tb.gestos++;
          for (const t of ["pointerdown", "touchstart", "wheel"]) B.ctx.document.disparar(t, { target: nada });
          B.ctx.document.disparar("click", { target: nada });   // toque en una zona vacía
        }
        const av = B.porIdGet("online-inactivo");
        if (!tb.aviso && av && !av.classList.contains("oculto") && /Vas a perder por inactividad/.test(av.innerHTML)) { tb.aviso = true; tb.avisoEn = pasado; }
        if (tb.perdioEn == null && srv.S.log.some(a => a.kind === "abandono" && a.payload.player === UB)) tb.perdioEn = pasado;
        if (tableroB.clicA != null && !tb.clic && pasado >= tableroB.clicA) {
          // pulsa el botón de acción que tenga delante (el principal o el de la carta), como en el navegador:
          // primero el clic (lo oye el documento) y después la acción del botón
          tb.clic = true;
          const ba = B.porIdGet("btn-accion"), pie = B.porIdGet("carta-pie").children.find(x => !x.disabled && x.onclick);
          const el = !ba.disabled && ba.onclick ? ba : pie;
          if (el) {
            const sel = el === ba ? "#btn-accion" : "#carta-pie button";
            B.ctx.document.disparar("click", { target: { closest: q => q.includes(sel) ? el : null } });
            tb.boton = el.textContent; el.onclick();
          }
        }
        if (tableroB.despertarA != null && pasado >= tableroB.despertarA) { tb.despierto = true; personaB.dormida = false; }
      }
    }
    // una persona de verdad pulsa aunque haya animaciones en marcha: si su pantalla lleva más de 3 s esperándola, actúa
    let actuo = false;
    for (const [E, act] of [[A, actA], [B, actB]]) {
      const P = E.ctx.PartidaOnline;
      if (!P.actual() || !leer(E, "estado.activa") || !P._necesitoActuar()) { E.nec = null; continue; }
      if (E.nec == null) E.nec = reloj.ahora;
      else if (reloj.ahora - E.nec > 3000 && act()) { P.actividad(); E.nec = null; actuo = true; break; }
    }
    if (actuo) continue;
    // con personas.reaccion (ms), cada persona actúa en cuanto pasa ese tiempo, aunque haya animaciones o cuentas
    // atrás en marcha (como una persona de verdad, que no espera a que se cierre la revisión del rival)
    if (personas.reaccion) {
      for (const [E, act] of [[A, actA], [B, actB]]) {
        if (E.ultimoToque == null) E.ultimoToque = reloj.ahora;
        if (reloj.ahora - E.ultimoToque >= personas.reaccion) { E.ultimoToque = reloj.ahora; if (act()) { E.ctx.PartidaOnline.actividad(); actuo = true; } }
      }
      if (actuo) continue;
    }
    if (reloj.hayTimeouts()) { reloj.paso(); pasos++; continue; }
    // inactividad: B deja de tocar la pantalla en su turno (la pestaña sigue abierta y enviando latidos)
    if (inactivoB && !personaB.dormida && !ina.cancelado && srv.S.status === "in_progress" && srv.S.log.length >= inactivoB.desde && leer(B, "estado.activa&&jugActual()===jugYo()")) {
      personaB.dormida = true; B.ctx.PartidaOnline._act.autoPerder = inactivoB.autoPerder !== false;
    }
    if (inactivoB && personaB.dormida) {
      const av = B.porIdGet("online-inactivo"), visible = !av.classList.contains("oculto") && /Vas a perder por inactividad/.test(av.innerHTML);
      if (visible && /en 5…/.test(av.innerHTML)) ina.aviso5 = true;
      if (visible && inactivoB.cancelar && /en 3…/.test(av.innerHTML)) {
        B.ctx.PartidaOnline.actividad(); personaB.dormida = false; ina.cancelado = true;        // un toque cancela la cuenta atrás
        ina.oculto = av.classList.contains("oculto"); continue;
      }
    }
    if (inactivoB && /data-tipo="inactividad"/.test(A.porIdGet("online-barra").innerHTML)) {
      ina.botonA = true;
      if (inactivoB.reclamar && !ina.reclamado) { ina.reclamado = true; A.porIdGet("online-reclamar").onclick(); continue; }
    }
    if (actA()) { A.ctx.PartidaOnline.actividad(); continue; }
    if (actB()) { B.ctx.PartidaOnline.actividad(); continue; }
    if (reloj.paso()) { pasos++; continue; }
    break;
  }
  const perfilIntacto = leer(A, PERFIL) === perfilAntes.A && leer(B, PERFIL) === perfilAntes.B;
  return { A, B, srv, pasos, reclamado, ina, reloj, rotoA: roto(A), rotoB: roto(B), perfilIntacto,
    tb, vistas: vistas.size, vistasIdx: [...vistas], preguntas: Object.keys(srv.S.qs).length, malVista, respuestasAjenas: srv.S.respuestasAjenas || 0 };
}

if (require.main !== module) { module.exports = { jugar, estadoFinal, leer }; return; }
(async () => {
  // ── 1. partidas completas
  console.log("── 1. Partidas completas 1 contra 1 (dos motores, servidor falso)");
  const semillas = [101, 202, 303, 404, 505, 606];
  let iguales = 0, cerradas = 0, sumaJugadas = 0, conPreguntas = 0, perfilesIntactos = 0;
  let totalPreguntas = 0, totalVistas = 0, totalMal = 0, totalAjenas = 0, marcasPend = 0, marcasEspera = 0, marcasSinDato = 0;
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
    totalPreguntas += r.preguntas; totalVistas += r.vistas; totalMal += r.malVista; totalAjenas += r.respuestasAjenas;
    // p_pendiente en mark_activity: cada móvil lo envía cuando espera una acción suya (sin renovar la actividad)
    // y cuando no (renovándola), además de en cada toque
    for (const u of [UA, UB]) {
      const m = r.srv.S.marcas.filter(x => x.u === u);
      if (m.some(x => x.p_pendiente === true && x.p_actividad === false)) marcasPend++;
      if (m.some(x => x.p_pendiente === false && x.p_actividad === true)) marcasEspera++;
      if (m.some(x => typeof x.p_pendiente !== "boolean")) marcasSinDato++;
    }
    if (r.perfilIntacto) perfilesIntactos++; else console.log(`   semilla ${s}: el perfil local cambió durante la partida online`);
  }
  ok(iguales === semillas.length, `mismo estado final y mismas trazas (dado, ruleta, fin) en los dos móviles: ${iguales}/${semillas.length}`);
  ok(cerradas === semillas.length, `report_result coincide y el servidor cierra como completed (nunca disputed): ${cerradas}/${semillas.length}`);
  ok(totalVistas >= totalPreguntas * 0.9, `quien no responde ve el mismo enunciado y las mismas opciones mientras el otro responde: ${totalVistas}/${totalPreguntas} preguntas`);
  ok(totalMal === 0, `en esa vista no tiene la opción correcta (q.a = -1), las opciones coinciden y sale «X está respondiendo…» con su nombre (fallos: ${totalMal})`);
  ok(totalAjenas === 0, `al intentar responder la pregunta del rival no sale ninguna respuesta hacia el servidor (intentos que llegaron: ${totalAjenas})`);
  ok(marcasPend === semillas.length * 2 && marcasEspera === semillas.length * 2 && marcasSinDato === 0,
    `mark_activity lleva p_pendiente: con acción pendiente (p_actividad false) ${marcasPend}/${semillas.length * 2} móviles, esperando al rival (p_actividad true) ${marcasEspera}/${semillas.length * 2}, sin el dato ${marcasSinDato}`);
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

  // ── 1c. el que mira ve la pregunta del rival antes de que la responda, con personas como las de verdad:
  // reaccionan a los 1,2 s aunque haya animaciones, no tocan la revisión ni las cartas del rival y responden
  // en 0,8–2,3 s. Sin ponerse al día, el motor del que mira se quedaba atrás (revisión de 10 s, cartas de 3,5 s,
  // ruleta) y se perdía las preguntas de casilla. Por tipo y en los dos sentidos.
  console.log("── 1c. Pregunta del rival a la vista antes de la respuesta (personas realistas, los dos sentidos)");
  const tabla = {}, rotasR = [];
  for (const s of [101, 202, 303, 404, 505, 606, 11, 12, 13]) {
    const r = await jugar({ personas: { soloSuyo: true, rapida: true, reaccion: 1200 }, semilla: s, turnos: s < 100 ? 15 : 5, semillaServidor: s + 9,
      preparar: s < 100 ? "estado.jugadores.forEach(j=>{j.reserva[1]+=3;j.reserva[0]+=4;j.puntos+=400})" : null });
    if (r.srv.S.motivo !== "completed" || estadoFinal(r.A) !== estadoFinal(r.B)) rotasR.push(s);
    for (const [i, q] of Object.entries(r.srv.S.qs)) {
      const k = q.tipo + (q.player === UA ? " del anfitrión, la ve el invitado" : " del invitado, la ve el anfitrión");
      tabla[k] = tabla[k] || { total: 0, vistas: 0 }; tabla[k].total++; if (r.vistasIdx.includes(+i)) tabla[k].vistas++;
    }
    if (r.malVista) rotasR.push(s + " (vista con la respuesta)");
  }
  for (const t of ["turno", "casilla", "examen"]) for (const d of [" del anfitrión, la ve el invitado", " del invitado, la ve el anfitrión"]) {
    const x = tabla[t + d] || { total: 0, vistas: 0 };
    ok(x.total > 0 && x.vistas === x.total, `pregunta de ${t}${d} antes de que responda: ${x.vistas}/${x.total}`);
  }
  ok(!rotasR.length, `esas partidas acaban completed, con el mismo estado y sin enseñar la respuesta${rotasR.length ? ": fallan " + rotasR.join(", ") : ""}`);

  // ── 2. abandono
  console.log("── 2. Abandono a mitad de partida");
  const ab = await jugar({ semilla: 777, turnos: 5, abandonaB: 25 });
  ok(ab.srv.S.status === "finished" && ab.srv.S.motivo === "forfeit" && ab.srv.S.ganador === UA, `leave_match de B: gana A por abandono (${ab.srv.S.motivo}, ganador ${ab.srv.S.ganador === UA ? "A" : ab.srv.S.ganador})`);
  ok(!leer(ab.A, "estado.activa") && !leer(ab.B, "estado.activa"), "los dos motores se detienen");
  ok(/abandono/.test(ab.A.porIdGet("ganador").textContent) || /abandon/.test(ab.A.porIdGet("online-cierre").textContent), `A ve el final por abandono: «${ab.A.porIdGet("ganador").textContent}» · «${ab.A.porIdGet("online-cierre").textContent}»`);
  ok(/Tu rival ha abandonado la sala/.test(ab.A.porIdGet("online-aviso-salida").innerHTML) && /Entendido/.test(ab.A.porIdGet("online-aviso-salida").innerHTML),
    "A ve el aviso «Tu rival ha abandonado la sala» con «Entendido»");

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

  // ── 5. arranque que falla: entrar() cierra el canal de Realtime antes de dar el error
  console.log("── 5. Arranque que falla");
  {
    const { reloj, A, srv } = montar(5, 5, 5);
    const sbA = srv.cliente(UA); let canales = 0, cerrados = 0;
    const canal0 = sbA.channel.bind(sbA);
    sbA.channel = n => { canales++; return canal0(n); };
    sbA.removeChannel = () => { cerrados++; };
    A.ctx.setInterval = function () { throw new TypeError("Failed to execute 'setInterval' on 'Window': Illegal invocation"); };   // fallo al arrancar el latido
    let error = null;
    try { await A.ctx.PartidaOnline.entrar(sbA, "M1", UA); } catch (e) { error = e; }
    ok(error && /Illegal invocation/.test(error.message), `entrar() devuelve el error real: «${error && error.message}»`);
    ok(canales === 1 && cerrados === 1, `el canal de Realtime abierto se cierra (abiertos ${canales}, cerrados ${cerrados})`);
    ok(!A.ctx.PartidaOnline.actual() && !leer(A, "estado.online"), "no queda ninguna partida a medias en el motor");
    void reloj;
  }

  // ── 6. inactividad (60 s sin tocar en su turno; distinto del corte de red)
  console.log("── 6. Inactividad");
  {
    const r = await jugar({ semilla: 61, turnos: 5, inactivoB: { desde: 6 }, limite: 120000 });
    const cl = r.srv.S.llamadas;
    ok(r.ina.aviso5, "a los 60 s sin actividad en su turno, B ve «Vas a perder por inactividad en 5…»");
    ok(r.srv.S.motivo === "forfeit" && r.srv.S.ganador === UA && cl.includes(UB.slice(-1) + ":leave_match") && !cl.some(l => /claim_/.test(l)),
      `al llegar a 0 pierde B (forfeit, gana A) sin que nadie reclame: ${r.srv.S.motivo}, ganador ${r.srv.S.ganador === UA ? "A" : r.srv.S.ganador}`);
  }
  {
    const r = await jugar({ semilla: 62, turnos: 5, inactivoB: { desde: 6, cancelar: true } });
    ok(r.ina.cancelado && r.ina.oculto, "un toque durante la cuenta atrás la cancela (el aviso desaparece)");
    ok(r.srv.S.motivo === "completed" && estadoFinal(r.A) === estadoFinal(r.B), `la partida sigue y termina con normalidad: ${r.srv.S.motivo}`);
  }
  {
    const r = await jugar({ semilla: 63, turnos: 5, inactivoB: { desde: 6, autoPerder: false, reclamar: true }, limite: 120000 });
    const n = r.srv.S.llamadas.filter(l => l === UA.slice(-1) + ":claim_inactivity").length;
    ok(r.ina.botonA, "con la pestaña de B abierta pero sin actividad, A ve «Reclamar victoria» por inactividad");
    ok(n === 1 && r.srv.S.motivo === "forfeit" && r.srv.S.ganador === UA, `claim_inactivity (al pulsar, ${n} vez) da la victoria a A`);
  }
  {
    const r = await jugar({ semilla: 64, turnos: 5, inactivoB: { desde: 6 }, conInactividad: false, limite: 120000 });
    ok(r.ina.aviso5 && r.srv.S.motivo === "forfeit" && r.srv.S.ganador === UA && !r.ina.botonA,
      "sin la migración: B pierde igual por inactividad (leave_match) y A no ve el botón de inactividad");
  }

  // ── 8. qué declara cada latido (mark_activity) en los cuatro casos
  console.log("── 8. Latidos: acción pendiente, esperando al rival, sin interacción y toque real");
  {
    const r = await jugar({ semilla: 81, turnos: 5, semillaServidor: 81, sinToques: true });
    // fuera el instante de entrada: entrar() registra una actividad real (se acaba de pulsar «Entrar» o «Empezar»)
    const m = r.srv.S.marcas.filter(x => x.t > EPOCA);
    const caso = (p, a) => m.filter(x => x.p_pendiente === p && x.p_actividad === a);
    ok(r.srv.S.motivo === "completed", `la partida sin toques registrados termina con normalidad (${r.srv.S.motivo})`);
    ok(caso(true, false).length > 0 && caso(true, true).length === 0,
      `1) con acción pendiente propia: p_pendiente true, p_actividad false (${caso(true, false).length} latidos; ninguno con p_actividad true)`);
    const espera = caso(false, true);
    ok(espera.length > 0 && espera.every(x => x.rivalPend),
      `2) esperando al rival: p_actividad true solo si el servidor sabe que el rival tiene algo pendiente (${espera.length} latidos, todos con el rival pendiente)`);
    const sinNada = caso(false, false);
    ok(sinNada.length > 0 && m.filter(x => x.p_pendiente === false && !x.rivalPend).every(x => x.p_actividad === false),
      `3) sin nada pendiente ni el rival: p_pendiente false, p_actividad false (${sinNada.length} latidos; ninguno así cuenta como actividad)`);
  }
  {
    const r = await jugar({ semilla: 82, turnos: 5, semillaServidor: 82 });
    const toques = r.srv.S.marcas.filter(x => x.p_actividad === true && !x.rivalPend && x.p_pendiente === false);
    // un toque real sin nada pendiente (caso 3 + toque): solo un toque puede llevar p_actividad true sin el rival pendiente
    ok(toques.length > 0, `4) un toque real lleva p_actividad true aunque no haya nada pendiente (${toques.length} toques así)`);
  }

  // ── 9. Inactividad: solo cuentan los botones de acción
  console.log("── 9. Inactividad: mover el tablero no cuenta, pulsar un botón sí");
  const t1 = await jugar({ semilla: 515, turnos: 5, tableroB: { desde: 12 } });
  const marcasT1 = t1.srv.S.marcas.filter(m => m.u === UB && t1.tb.ini != null && m.t >= EPOCA + t1.tb.ini + 1 && (t1.tb.perdioEn == null || m.t <= EPOCA + t1.tb.ini + t1.tb.perdioEn));
  ok(t1.tb.ini != null && t1.tb.gestos >= 25, `B mueve el tablero sin pulsar ningún botón (${t1.tb.gestos} gestos de arrastrar, ampliar y tocar zonas vacías)`);
  ok(t1.tb.aviso && t1.tb.avisoEn >= 60000 && t1.tb.avisoEn < 62000, `a los 60 s sale «Vas a perder por inactividad en 5…» (a los ${Math.round((t1.tb.avisoEn || 0) / 100) / 10} s)`);
  ok(t1.srv.S.status === "finished" && t1.srv.S.motivo === "forfeit" && t1.srv.S.ganador === UA && t1.tb.perdioEn >= 65000,
    `B pierde por inactividad (${t1.srv.S.motivo}, gana ${t1.srv.S.ganador === UA ? "A" : t1.srv.S.ganador}, a los ${Math.round((t1.tb.perdioEn || 0) / 1000)} s)`);
  ok(marcasT1.length > 0 && marcasT1.every(m => m.p_actividad === false), `mientras mueve el tablero, mark_activity lleva siempre p_actividad false (${marcasT1.length} envíos, ${marcasT1.filter(m => m.p_actividad).length} con true)`);
  const t2 = await jugar({ semilla: 515, turnos: 5, tableroB: { desde: 12, clicA: 30000, despertarA: 80000 } });
  const marcasT2 = t2.srv.S.marcas.filter(m => m.u === UB && m.t >= EPOCA + t2.tb.ini + 29000 && m.t <= EPOCA + t2.tb.ini + 31000);
  ok(t2.tb.clic && t2.tb.boton, `B mueve el tablero y a los 30 s pulsa «${t2.tb.boton}»`);
  ok(marcasT2.some(m => m.p_actividad === true), "ese botón envía mark_activity con p_actividad true");
  ok(!t2.tb.aviso || t2.tb.avisoEn > 30000 + 60000, `no sale la cuenta atrás a los 60 s del inicio${t2.tb.aviso ? " (sale a los " + Math.round(t2.tb.avisoEn / 1000) + " s, ya en otra espera)" : ""}`);
  ok(t2.tb.perdioEn == null && t2.srv.S.motivo === "completed", `B no pierde y la partida termina con normalidad (${t2.srv.S.motivo})`);

  // ── 7. aviso cuando el rival se va de la pantalla final (una vez por partida, sin tapar los puntos)
  console.log("── 7. Aviso de salida del rival");
  const avanzar = async (reloj, ms) => { const fin = reloj.ahora + ms; for (let i = 0; i < 5000 && reloj.ahora < fin; i++) { await vaciar(); if (!reloj.paso()) break; } await vaciar(); };
  for (const [tipo, texto, sem] of [["cuartel", "Tu rival ha abandonado la sala", 71], ["local", "Tu rival ha decidido jugar en modo local", 72]]) {
    const r = await jugar({ semilla: sem, turnos: 5, semillaServidor: sem });
    const av = () => r.B.porIdGet("online-aviso-salida");
    const antes = r.B.porIdGet("podio").innerHTML;
    ok(r.srv.S.motivo === "completed" && leer(r.B, "pantalla") === "fin", `partida terminada y B en la pantalla de puntos (${r.srv.S.motivo})`);
    r.A.ctx.PartidaOnline.despedirse(tipo);                     // A pulsa «${tipo === "local" ? "Otra partida" : "Volver al cuartel"}»
    await avanzar(r.reloj, 500);
    ok(new RegExp(texto).test(av().innerHTML) && !av().classList.contains("oculto") && r.B.porIdGet("podio").innerHTML === antes,
      `B ve «${texto}» y los puntos siguen en pantalla`);
    r.B.porIdGet("online-aviso-ok").onclick(); const html = av().innerHTML;
    ok(av().classList.contains("oculto"), "«Entendido» cierra el aviso");
    r.A.ctx.PartidaOnline.despedirse(tipo); await avanzar(r.reloj, 500);
    ok(av().classList.contains("oculto") && av().innerHTML === html, "el aviso sale una sola vez");
    ok(r.srv.S.enviados.filter(e => e.startsWith(UA.slice(-1) + ":salida:" + tipo)).length >= 1 && !r.srv.S.enviados.some(e => e.startsWith(UB.slice(-1) + ":")),
      "solo avisa quien se va");
  }

  // ── 10. revancha: «Otra partida» llama a request_rematch (nunca va al modo local por sí sola)
  console.log("── 10. Revancha");
  // avanza exactamente ms (un temporizador centinela impide saltar más allá, p. ej. al cierre del canal a los 10 min)
  const esperarMs = async (reloj, ms) => { let listo = false; reloj.setTimeout(() => { listo = true; }, ms); for (let i = 0; i < 50000 && !listo; i++) { await vaciar(); if (!reloj.paso()) break; } await vaciar(); };
  const pulsar = (E, sel, el) => E.ctx.document.disparar("click", { target: { closest: q => q.includes(sel) ? el : null } });
  const otra = E => { const b = E.ctx.document.querySelector('[data-act="otra"]'); b.dataset.act = "otra"; return b; };
  const pulsarOtra = E => pulsar(E, '[data-act="otra"]', otra(E));
  const pulsarLocal = E => pulsar(E, "#online-local", Object.assign(E.ctx.document.createElement("button"), { id: "online-local" }));
  const linea = E => E.porIdGet("online-revancha").innerHTML;
  const preparar = r => {
    const entradas = { A: [], B: [] };
    for (const [n, E] of [["A", r.A], ["B", r.B]]) E.ctx.PartidaOnline.entrar = async (sb, id) => { entradas[n].push(id); };
    return entradas;
  };
  {
    // a) los dos pulsan: partida nueva entre los dos, una sola
    const r = await jugar({ semilla: 81, turnos: 5, semillaServidor: 81 }), en = preparar(r);
    ok(r.srv.S.motivo === "completed" && leer(r.A, "pantalla") === "fin" && leer(r.B, "pantalla") === "fin", "partida terminada, los dos en la pantalla final");
    pulsarOtra(r.A); await esperarMs(r.reloj, 600);
    ok(/Esperando a tu rival/.test(linea(r.A)) && otra(r.A).disabled && /Esperando a tu rival/.test(otra(r.A).textContent), `A pulsa «Otra partida»: «${otra(r.A).textContent}» y la línea «Esperando a tu rival…»`);
    ok(r.srv.S.revancha.creadas === 0 && !en.A.length, "con una sola petición no se crea nada");
    ok(/Tu rival quiere la revancha/.test(linea(r.B)), "B ve «Tu rival quiere la revancha: pulsa «Otra partida»»");
    pulsarOtra(r.B); await esperarMs(r.reloj, 3000);
    ok(r.srv.S.revancha.creadas === 1 && en.A.join() === "M2" && en.B.join() === "M2", `B pulsa: se crea una partida (${r.srv.S.revancha.creadas}) y entran los dos en ella (A ${en.A.join() || "-"}, B ${en.B.join() || "-"})`);
    ok(leer(r.A, "estado.modo") === "online" && leer(r.B, "estado.modo") === "online", "ninguno arranca una partida local");
    pulsarOtra(r.A); await esperarMs(r.reloj, 600);
    ok(r.srv.S.revancha.creadas === 1, "pulsar otra vez no crea otra partida");
  }
  {
    // b) uno pulsa y el otro se va al modo local
    const r = await jugar({ semilla: 82, turnos: 5, semillaServidor: 82 }), en = preparar(r);
    pulsarOtra(r.A); await esperarMs(r.reloj, 600);
    pulsarLocal(r.B); await esperarMs(r.reloj, 600);
    const av = r.A.porIdGet("online-aviso-salida");
    ok(/Tu rival ha decidido jugar en modo local/.test(av.innerHTML) && !av.classList.contains("oculto"), "A, que esperaba, ve «Tu rival ha decidido jugar en modo local»");
    ok(!otra(r.A).disabled && otra(r.A).textContent === "Otra partida", "A deja de esperar: el botón vuelve a estar disponible");
    await esperarMs(r.reloj, 5000);
    ok(r.srv.S.revancha.creadas === 0 && !en.A.length && !en.B.length, "no se crea ninguna partida");
  }
  {
    // c) la petición caduca a los 2 minutos
    const r = await jugar({ semilla: 83, turnos: 5, semillaServidor: 83 }), en = preparar(r);
    pulsarOtra(r.A); await esperarMs(r.reloj, 119000);
    ok(/Esperando a tu rival/.test(linea(r.A)) && otra(r.A).disabled, `a los 119 s A sigue esperando (${linea(r.A)} · ${otra(r.A).disabled} · t=${r.reloj.ahora})`);
    await esperarMs(r.reloj, 2000);
    ok(/La revancha ha caducado/.test(linea(r.A)) && !otra(r.A).disabled && otra(r.A).textContent === "Otra partida", "a los 2 min: «La revancha ha caducado» y el botón vuelve a estar disponible");
    pulsarOtra(r.B); await esperarMs(r.reloj, 1000);
    ok(r.srv.S.revancha.creadas === 0 && !en.A.length && !en.B.length && /Esperando a tu rival/.test(linea(r.B)), "B pulsa después: la petición caducada de A no cuenta y B queda esperando");
  }
  {
    // d) máximo de 3 partidas activas
    const r = await jugar({ semilla: 84, turnos: 5, semillaServidor: 84 }), en = preparar(r);
    r.srv.S.revancha.activas[UB] = 3;
    pulsarOtra(r.B); await esperarMs(r.reloj, 600);
    ok(/Ya tienes 3 partidas a la vez/.test(linea(r.B)) && !otra(r.B).disabled, "B, con 3 partidas activas: «Ya tienes 3 partidas a la vez…» y el botón sigue disponible");
    pulsarOtra(r.A); await esperarMs(r.reloj, 600);
    ok(/Esperando a tu rival/.test(linea(r.A)) && r.srv.S.revancha.creadas === 0 && !en.A.length, `A pide la revancha y espera: no se crea nada (${linea(r.A)})`);
  }

  {
    // e) pasados 10 minutos (canal cerrado): «Otra partida» no arranca el modo local
    const r = await jugar({ semilla: 85, turnos: 5, semillaServidor: 85 }), en = preparar(r);
    await esperarMs(r.reloj, 11 * 60 * 1000);
    pulsarOtra(r.A); await esperarMs(r.reloj, 600);
    ok(/Ya no se puede pedir la revancha/.test(linea(r.A)) && leer(r.A, "estado.modo") === "online" && leer(r.A, "pantalla") === "fin" && !en.A.length,
      "a los 11 min: «Ya no se puede pedir la revancha…», sigue en la pantalla final y no arranca el modo local");
  }

  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.stack || e); process.exit(1); });
