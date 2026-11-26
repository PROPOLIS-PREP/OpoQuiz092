// Partida online de Patrullan2 (v2, subfase 3c): puente entre el motor del juego (index.html) y Supabase.
//
// Modelo lockstep: los dos móviles ejecutan el mismo motor con la misma semilla (jugada «inicio» de start_match)
// y aplican las mismas jugadas del registro (match_actions) en el mismo orden, también las propias: al decidir,
// el móvil envía la jugada y el motor solo avanza cuando la jugada vuelve del registro.
//
// El motor le pide al puente (estado.online):
//   esperar(tipos, fn, {mirar})   la siguiente jugada del registro (con mirar, sin consumirla)
//   enviar(tipo, datos)           submit_action con el número de jugada esperado
//   pedirPregunta({…})            draw_question            abrir(i)        get_current_question (empieza el tiempo)
//   comodin(i, tipo)              use_lifeline             responder(i, o) submit_answer (se ignora lo que devuelve)
//   resultado(i)                  get_question_result: la respuesta correcta solo llega aquí, con la pregunta cerrada
//   vencido()                     heartbeat (cierra por tiempo)        terminar(puntos) report_result
//   abandonar()                   leave_match              error(texto)    desincronización
// El puente además envía el latido cada 15 s, avisa si el rival no da señales y ofrece «Reclamar victoria».
// No escribe puntos del marcador, monedas ni logros: report_result solo cierra la partida.
(function () {
  "use strict";

  const LATIDO_MS = 15000, SONDEO_MS = 3000, SIN_SENAL_MS = 60000, INACTIVO_MS = 60000;
  const MARCA_MS = 10000;          // mark_activity como mucho cada 10 s
  const BLOQUEO_MS = 180000;       // sin nada pendiente, el rival solo puede reclamar a los 180 s (como claim_inactivity)
  const AVISO_S = 5;               // cuenta atrás «Vas a perder por inactividad en 5…»
  const GLOBALES = ["abandono", "fin"];

  // ───────────────────────────── Núcleo del puente (sin DOM: se prueba en Node con un servidor falso)
  function crearPuente(cfg) {
    // cfg: { sb, matchId, yo (uuid), alFin(fin), alError(texto), alAviso(texto), alEstado(info), reloj? }
    // Flechas que llaman a las funciones globales: guardadas tal cual en un objeto, el navegador lanza
    // «Illegal invocation» al llamarlas como R.setInterval(…) (solo admiten la ventana como «this»).
    const R = cfg.reloj || {
      setTimeout: (f, ms) => setTimeout(f, ms),
      setInterval: (f, ms) => setInterval(f, ms),
      clearInterval: id => clearInterval(id),
      ahora: () => Date.now(),
    };
    const sb = cfg.sb, M = cfg.matchId;
    const st = {
      log: new Map(), ultimo: -1, aplicado: 1, espera: null, cola: Promise.resolve(),
      cache: {}, terminado: false, ultimaRival: R.ahora(), turnoRival: false, roto: false,
      ultimaMarca: -Infinity, sinMarcar: false,   // sinMarcar: el servidor aún no tiene mark_activity (migración pendiente)
      esperando: true,                             // la pantalla no espera nada de este jugador (lo actualiza marcarEspera)
    };
    const rpc = async (f, args) => { const r = await sb.rpc(f, args); if (r.error) throw r.error; return r.data; };
    const fila = d => Array.isArray(d) ? d[0] : d;

    function recibir(a) {
      if (!a || st.log.has(a.seq)) return;
      st.log.set(a.seq, a);
      if (a.seq > st.ultimo) st.ultimo = a.seq;
      if (a.user_id && a.user_id !== cfg.yo) st.ultimaRival = R.ahora();
      // pregunta del rival: se pide ya el enunciado (sin la respuesta, que no sale hasta get_question_result)
      if (a.kind === "pregunta" && a.user_id && a.user_id !== cfg.yo) precargar(+a.payload.question_index);
      bombear();
    }
    // get_current_question pedida por quien NO responde: no abre la pregunta ni trae la respuesta correcta
    function precargar(i) {
      if (!st.cache[i]) st.cache[i] = (async () => {
        try {
          const d = await rpc("get_current_question", { p_match: M });
          const r = (d || []).find(x => +x.question_index === i);
          return r ? { texto: r.texto, opciones: r.opciones, descartadas: r.descartadas || [] } : null;
        } catch (e) { return null; }          // sin enunciado: se enseña solo «Tu rival está respondiendo»
      })();
      return st.cache[i];
    }
    async function leerNuevas() {
      const { data, error } = await sb.from("match_actions").select("seq, user_id, kind, payload")
        .eq("match_id", M).gt("seq", st.ultimo).order("seq");
      if (!error) (data || []).forEach(recibir);
      return !error;
    }
    function bombear() {
      while (!st.terminado && !st.roto) {
        const a = st.log.get(st.aplicado);
        if (!a) return;
        if (GLOBALES.includes(a.kind)) { st.aplicado++; global(a); continue; }
        const w = st.espera;
        if (!w) return;
        if (!w.tipos.includes(a.kind)) { error(`Se esperaba «${w.tipos.join(" / ")}» y llegó «${a.kind}» (jugada ${a.seq}).`); return; }
        st.espera = null;
        if (!w.mirar) st.aplicado++;
        R.setTimeout(() => w.fn(a), 0);         // fuera de esta pila: el motor registrará la siguiente espera
        return;
      }
    }
    function global(a) {
      if (a.kind === "abandono") { cfg.alAviso && cfg.alAviso(a.payload && a.payload.player === cfg.yo ? "Has abandonado la partida." : "Tu rival ha abandonado la partida."); return; }
      if (a.kind === "fin") { st.terminado = true; cfg.alFin && cfg.alFin(a.payload || {}); }
    }
    function error(texto) {
      if (st.roto) return;
      st.roto = true; cfg.alError && cfg.alError(texto);
    }
    const pendientes = () => st.ultimo >= st.aplicado;   // jugadas ya en el registro que el motor aún no ha aplicado

    // envíos en fila: nunca dos submit_action a la vez desde este móvil
    function enFila(fn) {
      st.cola = st.cola.then(fn).catch(e => { cfg.alAviso && cfg.alAviso(textoError(e)); });
      return st.cola;
    }
    const textoError = e => (e && e.message) ? e.message.replace(/\.?$/, ".") : "No hay conexión con el servidor.";

    const api = {
      esperar(tipos, fn, op = {}) { st.espera = { tipos, fn, mirar: !!op.mirar }; bombear(); },
      enviar(kind, payload) {
        if (pendientes() || st.terminado) return;    // al repasar el registro, la jugada ya está anotada
        enFila(async () => {
          for (let i = 0; i < 4; i++) {
            const { error } = await sb.rpc("submit_action", { p_match: M, p_expected_seq: st.ultimo + 1, p_kind: kind, p_payload: payload || {} });
            if (!error) { await leerNuevas(); return; }
            if (error.code === "40001") { await leerNuevas(); if (pendientes()) return; continue; }
            throw error;
          }
          throw { message: "No se pudo anotar la jugada" };
        });
      },
      pedirPregunta({ bloque, nivel, segundos, tipo }) {
        if (pendientes() || st.terminado) return;
        enFila(async () => { await rpc("draw_question", { p_match: M, p_bloque: bloque, p_nivel: nivel, p_segundos: segundos, p_tipo: tipo }); await leerNuevas(); });
      },
      async abrir(i) {
        if ([...st.log.values()].some(a => a.kind === "resultado" && +a.payload.question_index === i)) return null;  // ya cerrada
        try { const d = await rpc("get_current_question", { p_match: M }); const r = (d || []).find(x => +x.question_index === i); return r ? { texto: r.texto, opciones: r.opciones, descartadas: r.descartadas || [] } : null; }
        catch (e) { cfg.alAviso && cfg.alAviso(textoError(e)); return null; }
      },
      // la pregunta del rival en solo lectura: enunciado, opciones y descartadas, nunca la opción correcta
      ver(i) { return precargar(i); },
      comodin(i, kind) { enFila(async () => { await rpc("use_lifeline", { p_match: M, p_index: i, p_kind: kind }); await leerNuevas(); }); },
      responder(i, op) {
        // submit_answer devuelve la respuesta correcta, pero no se usa: llega con get_question_result (resultado)
        enFila(async () => { try { await rpc("submit_answer", { p_match: M, p_index: i, p_option: op }); } catch (e) { /* cerrada por tiempo: llegará «resultado» */ } await leerNuevas(); });
      },
      async resultado(i) {
        try {
          const r = fila(await rpc("get_question_result", { p_match: M, p_index: i }));
          const c = (st.cache[i] && await st.cache[i]) || {};
          return r ? { respuesta_correcta: r.respuesta_correcta, explicacion: r.explicacion, texto: c.texto, opciones: c.opciones } : null;
        } catch (e) { return null; }
      },
      vencido() { enFila(async () => { await rpc("heartbeat", { p_match: M }); await leerNuevas(); }); },
      terminar(puntos) { enFila(async () => { await rpc("report_result", { p_match: M, p_scores: puntos }); await leerNuevas(); }); },
      abandonar() { enFila(async () => { await rpc("leave_match", { p_match: M }); await leerNuevas(); }); },
      reclamar(uid) { return enFila(async () => { await rpc("claim_forfeit", { p_match: M, p_user: uid }); await leerNuevas(); }); },
      // actividad de la persona (toque, clic o tecla): mark_activity como mucho cada 10 s; forzar, sin esperar.
      // Lleva siempre p_pendiente: si la pantalla espera algo de este jugador.
      actividad(forzar) {
        const t = R.ahora();
        if (st.sinMarcar || st.terminado || (!forzar && t - st.ultimaMarca < MARCA_MS)) return;
        st.ultimaMarca = t;
        marcar({ p_pendiente: !st.esperando, p_actividad: true });
      },
      reclamarInactividad(uid) { return enFila(async () => { await rpc("claim_inactivity", { p_match: M, p_user: uid }); await leerNuevas(); }); },
      error,
      // para el motor y la pantalla
      marcarTurnoRival(v) { if (v && !st.turnoRival) st.ultimaRival = R.ahora(); st.turnoRival = v; },
      // true: la pantalla no espera nada de este jugador. Al cambiar, se avisa al servidor en el momento
      // (pendiente_desde preciso); esperar cuenta como actividad, quedarse pendiente no.
      marcarEspera(v) {
        const antes = st.esperando; st.esperando = v;
        if (antes !== v && !st.sinMarcar && !st.terminado) marcar({ p_pendiente: !v, p_actividad: v });
      },
      _estado: st, _recibir: recibir, _leer: leerNuevas,
    };

    // latido, sondeo y estado del rival
    let latido = null, sondeo = null;
    // mark_activity(p_match, p_pendiente, p_actividad); sin la migración (PGRST202) se deja de usar
    function marcar(args) {
      return sb.rpc("mark_activity", Object.assign({ p_match: M }, args)).then(r => {
        if (r && r.error && (r.error.code === "PGRST202" || /mark_activity/.test(r.error.message || ""))) st.sinMarcar = true;
        return r;
      }, () => null);
    }
    async function latir() {
      if (st.terminado) return;
      // cada latido declara si la pantalla espera algo de este jugador (p_pendiente). Esperar sin nada pendiente
      // cuenta como actividad; con algo pendiente solo se informa (no renueva la actividad: así cuentan los 60 s)
      const r = st.sinMarcar ? null : await marcar({ p_pendiente: !st.esperando, p_actividad: !!st.esperando });
      if (!r || r.error) { try { await rpc("heartbeat", { p_match: M }); } catch (e) { /* sin conexión */ } }
      try {
        // «*»: así funciona con y sin la columna ultima_actividad_at (migración de inactividad)
        const { data } = await sb.from("match_players").select("*").eq("match_id", M);
        const rival = (data || []).find(j => j.user_id !== cfg.yo);
        if (rival && cfg.alEstado) {
          const silencio = R.ahora() - Date.parse(rival.last_heartbeat);
          // mismas reglas que claim_inactivity: con algo pendiente, 60 s; sin nada pendiente, 180 s
          const act = rival.ultima_actividad_at ? Math.max(Date.parse(rival.ultima_actividad_at), st.ultimaRival) : null;
          const pend = rival.pendiente_desde ? Date.parse(rival.pendiente_desde) : null;
          const ref = act == null ? null : pend != null ? Math.max(act, pend) : act;
          const quieto = ref != null ? R.ahora() - ref : null;
          cfg.alEstado({ rival: rival.user_id, sinSenal: silencio >= SIN_SENAL_MS, silencio,
            inactivo: st.turnoRival && R.ahora() - st.ultimaRival >= INACTIVO_MS,
            sinActividad: quieto != null && quieto >= (pend != null ? INACTIVO_MS : BLOQUEO_MS), quieto, pendiente: pend != null });
        }
      } catch (e) { /* se reintenta en el siguiente latido */ }
    }
    api.arrancar = async () => {
      await leerNuevas();
      if (sb.channel) {
        api._canal = sb.channel("partida-" + M, { config: { broadcast: { self: false } } })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "match_actions", filter: "match_id=eq." + M }, p => recibir(p.new))
          // aviso efímero del rival al salir de la pantalla final (no se guarda en la base de datos)
          .on("broadcast", { event: "salida" }, m => { const p = (m && m.payload) || {}; if (p.de !== cfg.yo && cfg.alSalida) cfg.alSalida(p); })
          .subscribe();
      }
      latido = R.setInterval(latir, LATIDO_MS);
      sondeo = R.setInterval(() => { if (!st.terminado) leerNuevas(); }, SONDEO_MS);
      latir();
    };
    // parar({mantenerCanal}): sin latido ni sondeo; el canal sigue abierto para el aviso de salida del rival
    api.parar = (op = {}) => {
      R.clearInterval(latido); R.clearInterval(sondeo);
      if (!op.mantenerCanal) api.cerrarCanal();
    };
    api.cerrarCanal = () => {
      if (api._canal && sb.removeChannel) { try { sb.removeChannel(api._canal); } catch (e) { /* nada */ } }
      api._canal = null;
    };
    // tipo: "cuartel" (volver al cuartel o salir) | "local" (otra partida en modo local)
    api.avisarSalida = tipo => {
      try { if (api._canal && api._canal.send) return Promise.resolve(api._canal.send({ type: "broadcast", event: "salida", payload: { tipo, de: cfg.yo } })).catch(() => {}); }
      catch (e) { /* sin canal: el rival no recibe el aviso */ }
      return Promise.resolve();
    };
    api.inicio = () => st.log.get(0) || null;
    return api;
  }

  if (typeof module !== "undefined" && module.exports && typeof window === "undefined") { module.exports = { crearPuente }; return; }

  // ───────────────────────────── Entrada en la partida y pantalla (navegador)
  let actual = null;

  function barra() {
    let b = document.getElementById("online-barra");
    if (!b) {
      b = document.createElement("div"); b.id = "online-barra";
      b.setAttribute("role", "status");
      const s = document.createElement("style");
      s.textContent = `#online-barra{position:fixed;left:50%;transform:translateX(-50%);top:calc(6px + env(safe-area-inset-top));z-index:45;max-width:calc(100% - 24px);
        display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;background:rgba(6,27,69,.88);color:#fff;border:2px solid #f7bf42;border-radius:14px;
        padding:4px 10px;font-size:12.5px;font-weight:800;box-shadow:0 3px 8px #0006}
        #online-barra .btn{font-size:13px;padding:4px 10px}
        #online-barra.oculto{display:none}
        #online-inactivo{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:60;max-width:calc(100% - 32px);text-align:center;
          background:#b60928;color:#fff;border:3px solid #ffcb2e;border-radius:18px;padding:16px 20px;font-family:var(--display);font-size:22px;box-shadow:0 6px 18px #000a}
        #online-inactivo small{display:block;font-family:inherit;font-size:13px;opacity:.9;margin-top:4px}
        #online-inactivo.oculto{display:none}
        .online-aviso{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
        .online-aviso.oculto{display:none}`;
      document.head.appendChild(s);
      document.body.appendChild(b);
    }
    return b;
  }
  function pintarBarra(info) {
    const b = barra();
    if (!actual || (typeof estado !== "undefined" && estado.fase === "fin" && !actual.forfeitPosible)) { b.classList.add("oculto"); return; }
    b.classList.remove("oculto");
    const rival = actual.jugadores.find(j => j.id !== actual.yoUid);
    const nom = rival ? window.CuentaOnline.util.esc(rival.nombre) : "tu rival";
    let txt = `🌐 Online · ${nom}: `;
    if (info && info.sinSenal) txt += `sin señal desde hace ${Math.round(info.silencio / 1000)} s`;
    else if (info && info.sinActividad) txt += `sin actividad desde hace ${Math.round(info.quieto / 1000)} s`;
    else if (info && info.inactivo) txt += "lleva tiempo sin jugar";
    else txt += "conectado";
    // corte de red → claim_forfeit; pestaña abierta pero 60 s sin actividad en su turno → claim_inactivity
    const tipo = info && info.sinSenal ? "red" : info && info.sinActividad ? "inactividad" : null;
    b.innerHTML = `<span>${txt}</span>` + (tipo ? `<button class="btn rojo peq" id="online-reclamar" data-tipo="${tipo}">Reclamar victoria</button>` : "");
    const r = document.getElementById("online-reclamar");
    if (r) r.onclick = () => {
      r.disabled = true;
      const p = tipo === "inactividad" ? actual.puente.reclamarInactividad(info.rival) : actual.puente.reclamar(info.rival);
      p.then(() => { r.disabled = false; });
    };
  }

  function finPorServidor(fin) {
    const yo = actual && actual.yoUid;
    let texto;
    if (fin.reason === "forfeit") texto = fin.winner === yo ? "Tu rival ha abandonado: ganas la partida." : "Has abandonado: la partida la gana tu rival.";
    else if (fin.reason === "disputed") texto = "Los dos móviles no coinciden en el resultado: la partida queda en revisión, sin ganador.";
    else texto = fin.winner ? (fin.winner === yo ? "Resultado confirmado: ¡has ganado!" : "Resultado confirmado por el servidor.") : "Resultado confirmado: empate.";
    if (typeof estado !== "undefined" && estado.online && estado.activa) {
      // la partida termina antes de los turnos (abandono): se detiene el motor y se enseña el final
      estado.tok++; estado.activa = false; estado.fase = "fin";
      try { clearInterval(temporizador); } catch (e) { /* nada */ }
      try { cerrarCarta(); cerrarInfo(); Ruleta.cerrar(); document.getElementById("velo-preg").classList.remove("on"); } catch (e) { /* nada */ }
      document.getElementById("ganador").textContent = fin.reason === "forfeit" ? (fin.winner === yo ? "¡Has ganado por abandono!" : "Has abandonado") : "Partida terminada";
      document.getElementById("podio").innerHTML = ""; document.getElementById("logros").innerHTML = "";
      document.getElementById("premios").innerHTML = `<div style="--i:0">Partida online: sin premios en esta versión</div><div style="--i:1" id="online-cierre"></div>`;
      ir("fin");
    }
    const c = document.getElementById("online-cierre"); if (c) c.textContent = texto;
    if (fin.reason === "forfeit" && fin.winner === yo) avisoSalida("Tu rival ha abandonado la sala.");
    if (actual) {
      // la partida ha terminado: sin latido ni sondeo, pero con el canal abierto un rato para el aviso de salida del rival
      cerrarDespedida();
      despedida = { puente: actual.puente, cierre: setTimeout(cerrarDespedida, 10 * 60 * 1000) };
      actual.puente.parar({ mantenerCanal: true }); actual = null;
    }
    pintarBarra(null);
    if (AVISO.pendiente) avisoSalida(AVISO.pendiente);
  }

  // ───────────────────────────── Aviso cuando el rival se va (una vez por partida, sin tapar los puntos)
  let despedida = null;
  const AVISO = { mostrado: false, pendiente: null };
  function avisoSalida(texto) {
    if (AVISO.mostrado) return;
    if (typeof pantalla === "undefined" || pantalla !== "fin") { AVISO.pendiente = texto; return; }   // se enseña al llegar al final
    AVISO.mostrado = true; AVISO.pendiente = null;
    barra();                                                     // estilos
    let el = document.getElementById("online-aviso-salida");
    if (!el) {
      el = document.createElement("div"); el.id = "online-aviso-salida"; el.className = "tarjeta online-aviso"; el.setAttribute("role", "status");
      const fin = document.getElementById("s-fin"); if (fin) fin.prepend(el);
    }
    el.classList.remove("oculto");
    el.innerHTML = `<b>${window.CuentaOnline.util.esc(texto)}</b> <button class="btn azul peq" id="online-aviso-ok">Entendido</button>`;
    const ok = document.getElementById("online-aviso-ok");
    if (ok) ok.onclick = () => el.classList.add("oculto");
  }
  function alSalidaRival(p) {
    avisoSalida(p.tipo === "local" ? "Tu rival ha decidido jugar en modo local." : "Tu rival ha abandonado la sala.");
  }
  // quien pulsa «Volver al cuartel» u «Otra partida» en la pantalla final se lo dice a su rival
  function despedirse(tipo) {
    const p = (despedida && despedida.puente) || (actual && actual.puente);
    if (!p) return;
    p.avisarSalida(tipo);
    setTimeout(cerrarDespedida, 1500);
  }
  function cerrarDespedida() {
    if (!despedida) return;
    clearTimeout(despedida.cierre); despedida.puente.cerrarCanal(); despedida = null;
  }
  document.addEventListener("click", e => {
    const b = e.target && e.target.closest && e.target.closest('#s-fin [data-act="volver"], #s-fin [data-act="otra"]');
    if (b && (despedida || actual)) despedirse(b.dataset.act === "otra" ? "local" : "cuartel");
  }, true);

  async function entrar(sb, matchId, yoUid) {
    if (!actual || actual.matchId !== matchId) { cerrarDespedida(); Object.assign(AVISO, { mostrado: false, pendiente: null }); }
    if (actual) {
      if (actual.matchId === matchId) { if (typeof estado !== "undefined" && estado.online && estado.activa) ir("juego"); return; }   // ya dentro: volver al tablero
      actual.puente.parar(); actual = null;
    }
    const { data: js, error } = await sb.from("match_players").select("user_id, seat").eq("match_id", matchId).order("seat");
    if (error) throw error;
    const ids = (js || []).map(j => j.user_id);
    const { data: ps } = await sb.from("profiles").select("id, username").in("id", ids);
    const nombre = id => ((ps || []).find(p => p.id === id) || {}).username || "Agente";
    const puente = crearPuente({
      sb, matchId, yo: yoUid,
      alFin: finPorServidor,
      alError: t => { toast("Partida desincronizada: " + t); if (estado.online) { estado.tok++; estado.activa = false; } panelInfo({ sello: "Partida online", color: "var(--rojo)", tit: "Partida desincronizada", txt: t + " La partida se detiene; puedes abandonarla desde la lista de partidas." }); },
      alAviso: t => toast(t),
      alEstado: info => pintarBarra(info),
      alSalida: alSalidaRival,
    });
    try { await puente.arrancar(); }
    catch (e) { puente.parar(); throw e; }   // si el arranque falla, no quedan abiertos el canal de Realtime ni los intervalos
    const ini = puente.inicio();
    if (!ini) { puente.parar(); throw { message: "La partida todavía no ha empezado" }; }
    const orden = ini.payload.players || ids;
    const jugadores = orden.map(id => ({ id, nombre: nombre(id) }));
    const yo = orden.indexOf(yoUid);
    if (yo < 0) { puente.parar(); throw { message: "No juegas en esta partida" }; }
    actual = { matchId, yoUid, jugadores, puente };
    const on = Object.assign(puente, { yo, jugadores, turnos: +ini.payload.turns });
    iniciar("online", { semilla: ini.payload.seed, online: on });
    pintarBarra(null);
    Object.assign(ACT, { local: Date.now(), inicioTurno: Date.now(), eraMio: false, perdido: false });
    puente.actividad(true);
    // de quién es el turno (aviso de rival inactivo) y la inactividad propia: 60 s sin tocar en tu turno → 5…1 → pierdes
    const vigilar = setInterval(() => {
      if (!actual || actual.puente !== puente) { clearInterval(vigilar); ocultarAviso(); return; }
      const p = typeof jugActual === "function" ? jugActual() : null;
      puente.marcarTurnoRival(!!(p && p.remoto));
      // solo cuenta la inactividad mientras la pantalla espera algo de este jugador (no mientras espera al rival)
      const mio = estado.online && estado.activa && necesitoActuar(), t = Date.now();
      puente.marcarEspera(!mio);
      if (mio && !ACT.eraMio) ACT.inicioTurno = t;               // el reloj empieza cuando se te pide algo
      ACT.eraMio = mio;
      if (!mio) { ocultarAviso(); return; }
      const quieto = t - Math.max(ACT.local, ACT.inicioTurno);
      if (quieto < INACTIVO_MS) { ocultarAviso(); return; }
      const n = AVISO_S - Math.floor((quieto - INACTIVO_MS) / 1000);
      if (n > 0) avisoInactividad(n);
      else if (ACT.autoPerder && !ACT.perdido) {
        ACT.perdido = true; ocultarAviso();
        toast("Has perdido la partida por inactividad.");
        puente.abandonar();                                      // para el servidor, la pierde el jugador inactivo
      }
    }, 250);
  }

  // ───────────────────────────── Actividad: cualquier toque, clic o tecla (también «Continuar» en una ventana)
  const ACT = { local: 0, inicioTurno: 0, eraMio: false, perdido: false, autoPerder: true };
  function actividad() {
    ACT.local = Date.now();
    ocultarAviso();
    if (actual) actual.puente.actividad();
  }
  ["pointerdown", "keydown", "touchstart", "wheel"].forEach(t => document.addEventListener(t, actividad, { capture: true, passive: true }));
  function avisoInactividad(n) {
    barra();                                                     // crea también los estilos
    let a = document.getElementById("online-inactivo");
    if (!a) { a = document.createElement("div"); a.id = "online-inactivo"; a.setAttribute("role", "alert"); document.body.appendChild(a); }
    a.classList.remove("oculto");
    a.innerHTML = `Vas a perder por inactividad en ${n}…<small>Toca la pantalla para seguir jugando</small>`;
  }
  function ocultarAviso() { const a = document.getElementById("online-inactivo"); if (a) a.classList.add("oculto"); }
  // ¿la pantalla espera algo de este jugador? (botón de acción activo, carta propia con botones o lista, su pregunta, su despliegue)
  function necesitoActuar() {
    const pa = typeof preguntaActiva !== "undefined" ? preguntaActiva : null;
    if (pa && pa.online && !pa.p.remoto && !pa.respondida && !pa.enviada && pa.q && pa.q.o && pa.q.o.length) return true;
    const p = jugActual(), mio = p && !p.remoto;
    const b = document.getElementById("btn-accion");
    if (b && !b.disabled && b.onclick) return true;            // Responder, Tirar dado, Terminar despliegue (solo salen activos para ti)
    const velo = document.getElementById("velo-carta"), pie = document.getElementById("carta-pie"), ex = document.getElementById("carta-extra");
    if (mio && velo && velo.classList.contains("on")) {
      if (pie && [...pie.children].some(x => !x.disabled && x.onclick)) return true;   // carta de tu turno esperando tu botón
      if (ex && ex.onclick) return true;                         // elegir en una lista (comisaría, lanzar, recolocar)
    }
    if (mio && estado.fase === "despliegue") return true;
    return false;
  }

  window.PartidaOnline = { entrar, crearPuente, actual: () => actual, actividad, despedirse, _act: ACT, _necesitoActuar: necesitoActuar };
})();
