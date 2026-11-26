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
      ultimaMarca: -Infinity, ultimoToque: -Infinity, sinMarcar: false,   // sinMarcar: el servidor aún no tiene mark_activity (migración pendiente)
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
    // Un fallo de red no se guarda: se reintenta (3 veces) y, si aun así no llega, la próxima llamada vuelve a pedirlo.
    const cerrada = i => [...st.log.values()].some(a => a.kind === "resultado" && +a.payload.question_index === i);
    function precargar(i) {
      if (!st.cache[i]) st.cache[i] = (async () => {
        for (let k = 0; k < 3 && !cerrada(i) && !st.terminado; k++) {
          try {
            const d = await rpc("get_current_question", { p_match: M });
            const r = (d || []).find(x => +x.question_index === i);
            if (r) return { texto: r.texto, opciones: r.opciones, descartadas: r.descartadas || [] };
          } catch (e) { /* se reintenta */ }
          await new Promise(ok => R.setTimeout(ok, 400));
        }
        return null;                          // sin enunciado: se enseña solo «Tu rival está respondiendo»
      })().then(d => { if (!d) delete st.cache[i]; return d; });
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
      // ¿el registro ya trae jugadas que este motor aún no ha aplicado? Entonces el otro va por delante
      // y las pausas de cortesía (revisión, cartas del rival) se acortan para no perderse su pregunta.
      atrasado() { return !st.terminado && !st.roto && pendientes(); },
      enviar(kind, payload) {
        cfg.alAccion && cfg.alAccion();               // siempre sale de un botón de acción de esta persona
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
        if (cerrada(i)) return null;  // ya cerrada
        try { const d = await rpc("get_current_question", { p_match: M }); const r = (d || []).find(x => +x.question_index === i); return r ? { texto: r.texto, opciones: r.opciones, descartadas: r.descartadas || [] } : null; }
        catch (e) { cfg.alAviso && cfg.alAviso(textoError(e)); return null; }
      },
      // la pregunta del rival en solo lectura: enunciado, opciones y descartadas, nunca la opción correcta
      ver(i) { return precargar(i); },
      comodin(i, kind) { cfg.alAccion && cfg.alAccion(); enFila(async () => { await rpc("use_lifeline", { p_match: M, p_index: i, p_kind: kind }); await leerNuevas(); }); },
      responder(i, op) {
        cfg.alAccion && cfg.alAccion();
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
      // actividad de la persona: solo los botones de acción (responder, tirar, continuar, aceptar o rechazar,
      // elegir, comprar, salir de servicio…). mark_activity con p_actividad true como mucho cada 10 s; forzar, sin esperar.
      // Lleva siempre p_pendiente: si la pantalla espera algo de este jugador.
      actividad(forzar) {
        const t = R.ahora();
        if (st.sinMarcar || st.terminado || (!forzar && t - st.ultimaMarca < MARCA_MS)) return;
        st.ultimaMarca = t;
        marcar({ p_pendiente: !st.esperando, p_actividad: true });
      },
      // cualquier otra interacción (arrastrar o ampliar el tablero, desplazarse, tocar una zona vacía, abrir una
      // ficha…): se informa con p_actividad false, como mucho cada 10 s y nunca justo después de una acción
      toque() {
        const t = R.ahora();
        if (st.sinMarcar || st.terminado || t - st.ultimoToque < MARCA_MS || t - st.ultimaMarca < MARCA_MS) return;
        st.ultimoToque = t;
        marcar({ p_pendiente: !st.esperando, p_actividad: false });
      },
      reclamarInactividad(uid) { return enFila(async () => { await rpc("claim_inactivity", { p_match: M, p_user: uid }); await leerNuevas(); }); },
      error,
      // para el motor y la pantalla
      marcarTurnoRival(v) { if (v && !st.turnoRival) st.ultimaRival = R.ahora(); st.turnoRival = v; },
      // true: la pantalla no espera nada de este jugador. Al cambiar, se avisa al servidor en el momento
      // (pendiente_desde preciso). Ver estadoLatido() para cuándo cuenta como actividad.
      marcarEspera(v) {
        const antes = st.esperando; st.esperando = v;
        if (antes !== v && !st.sinMarcar && !st.terminado) leerRival().then(() => { if (st.esperando === v && !st.terminado) marcar(estadoLatido()); });
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
    // ¿El servidor sabe que el rival tiene una acción pendiente? (su pendiente_desde, leído en el último latido,
    // o una pregunta suya repartida y todavía sin resultado en el registro)
    function rivalPendiente() {
      if (st.rivalPendDesde) return true;
      let abierta = null;
      for (const a of st.log.values()) {
        if (a.kind === "pregunta" && a.user_id && a.user_id !== cfg.yo) abierta = +a.payload.question_index;
        else if (a.kind === "resultado" && +a.payload.question_index === abierta) abierta = null;
      }
      return abierta != null;
    }
    // Lo que declara cada latido (y cada cambio de lo que espera la pantalla):
    //   · acción pendiente propia → p_pendiente true, p_actividad false (informa sin contar como actividad);
    //   · esperando al rival, que tiene una acción pendiente que el servidor conoce → p_pendiente false, p_actividad true;
    //   · nada pendiente y el rival tampoco (pestaña abierta sin interacción) → p_pendiente false, p_actividad false.
    // Un toque real (actividad()) siempre lleva p_actividad true.
    function estadoLatido() {
      const pendiente = !st.esperando;
      return { p_pendiente: pendiente, p_actividad: !pendiente && rivalPendiente() };
    }
    // estado del rival en el servidor justo antes de declarar el propio («*»: con y sin la migración de inactividad)
    async function leerRival() {
      try {
        const { data } = await sb.from("match_players").select("*").eq("match_id", M);
        const rival = (data || []).find(j => j.user_id !== cfg.yo) || null;
        st.rivalPendDesde = rival && rival.pendiente_desde ? rival.pendiente_desde : null;
        return rival;
      } catch (e) { return null; }
    }
    async function latir() {
      if (st.terminado) return;
      const rival = await leerRival();
      const r = st.sinMarcar ? null : await marcar(estadoLatido());
      if (!r || r.error) { try { await rpc("heartbeat", { p_match: M }); } catch (e) { /* sin conexión */ } }
      try {
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
          // revancha: el rival la ha pedido (pedida) o ya está creada (creada, con su id)
          .on("broadcast", { event: "revancha" }, m => { const p = (m && m.payload) || {}; if (p.de !== cfg.yo && cfg.alRevancha) cfg.alRevancha(p); })
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
    // revancha (request_rematch): «esperando» con los segundos que vale la petición, o «creada» con la partida nueva
    api.pedirRevancha = async () => fila(await rpc("request_rematch", { p_match: M }));
    // ¿ya existe la revancha de esta partida? (la ven los dos jugadores por RLS)
    api.buscarRevancha = async () => {
      const { data, error } = await sb.from("matches").select("id, status").eq("rematch_of", M);
      return !error && data && data.length ? data[0] : null;
    };
    api.avisarRevancha = payload => {
      try { if (api._canal && api._canal.send) return Promise.resolve(api._canal.send({ type: "broadcast", event: "revancha", payload: Object.assign({ de: cfg.yo }, payload) })).catch(() => {}); }
      catch (e) { /* sin canal: el rival lo verá al consultar */ }
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
    else if (fin.reason === "disputed") texto = "La partida queda en revisión, sin ganador.";
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
    pintarPremios(fin, actual ? actual.jugadores : []);
    const c = document.getElementById("online-cierre"); if (c) c.textContent = texto;
    if (fin.reason === "forfeit" && fin.winner === yo) avisoSalida("Tu rival ha abandonado la sala.");
    if (actual) {
      // la partida ha terminado: sin latido ni sondeo, pero con el canal abierto un rato para el aviso de salida del rival
      cerrarDespedida();
      despedida = { puente: actual.puente, sb: actual.sb, yo: actual.yoUid, cierre: setTimeout(cerrarDespedida, 10 * 60 * 1000) };
      actual.puente.parar({ mantenerCanal: true }); actual = null;
    }
    pintarBarra(null);
    if (AVISO.pendiente) avisoSalida(AVISO.pendiente);
    pintarFinOnline();
  }

  // ───────────────────────────── Premios de la partida (3d): los calcula el servidor y llegan en la jugada «fin»
  // Los dos móviles enseñan lo mismo: cada jugador con sus puntos (cambio real y total), monedas y logros nuevos.
  // disputed: «Resultado en revisión» para los dos, sin puntos ni monedas.
  function textoPremios(fin, jugadores) {
    const esc = s => window.CuentaOnline.util.esc(String(s));
    if (fin.reason === "disputed") {
      return `<div style="--i:0"><b>Resultado en revisión</b>: los dos móviles no coinciden. Sin puntos ni monedas hasta que se resuelva.</div>`;
    }
    const pr = fin.premios || {};
    const ids = (jugadores || []).map(j => j.id).filter(id => pr[id]);
    Object.keys(pr).forEach(id => { if (!ids.includes(id)) ids.push(id); });
    if (!ids.length) return `<div style="--i:0">Partida online: sin premios en esta versión</div>`;
    const nombre = id => ((jugadores || []).find(j => j.id === id) || {}).nombre || "Agente";
    const signo = n => n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0";
    return ids.map((id, k) => {
      const p = pr[id], logros = (p.logros || []).map(l => ` · 🏅 ${esc(l.nombre)}${l.monedas ? ` (+${l.monedas} monedas)` : ""}`).join("");
      return `<div style="--i:${k}" data-premio="${esc(id)}"><b>${esc(nombre(id))}</b>: ${signo(+p.puntos)} puntos (total ${+p.total}) · +${+p.monedas} monedas${logros}</div>`;
    }).join("");
  }
  function pintarPremios(fin, jugadores) {
    const pr = document.getElementById("premios"); if (!pr) return;
    pr.innerHTML = textoPremios(fin, jugadores) + `<div style="--i:3" id="online-cierre"></div>`;
    if (fin.reason === "disputed") { const g = document.getElementById("ganador"); if (g) g.textContent = "Resultado en revisión"; }
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
    pararEspera();                                               // si esperaba la revancha, ya no llegará
    if (REV.lineaRival) lineaRevancha("");
    avisoSalida(p.tipo === "local" ? "Tu rival ha decidido jugar en modo local." : "Tu rival ha abandonado la sala.");
  }

  // ───────────────────────────── Revancha: «Otra partida» en la pantalla final de una partida online
  // Llama a request_rematch. Si el rival aún no la ha pedido: «Esperando a tu rival…» (la petición vale 2 minutos;
  // al caducar, «La revancha ha caducado» y el botón vuelve). Si la revancha se crea, los dos entran en ella.
  // Nunca va al modo local por sí sola: para eso está «Jugar en local».
  const REV = { esperando: false, sondeo: null, caduca: null, entrando: false, lineaRival: false };
  const textoErr = e => (e && e.message) ? e.message.replace(/\.?$/, ".") : "No hay conexión con el servidor.";
  function lineaRevancha(texto) {
    let el = document.getElementById("online-revancha");
    if (!el) {
      barra();                                                   // estilos
      el = document.createElement("div"); el.id = "online-revancha"; el.className = "tarjeta online-aviso"; el.setAttribute("role", "status");
      const fin = document.getElementById("s-fin"); if (fin) fin.prepend(el);
    }
    REV.lineaRival = false;
    el.classList.toggle("oculto", !texto);
    el.innerHTML = texto ? "<b>" + window.CuentaOnline.util.esc(texto) + "</b>" : "";
  }
  function botonOtra() { const f = document.getElementById("s-fin"); return f && f.querySelector('[data-act="otra"]'); }
  function botonOtraListo(listo) {
    const b = botonOtra(); if (!b) return;
    b.disabled = !listo; b.textContent = listo ? "Otra partida" : "Esperando a tu rival…";
  }
  // en la pantalla final de una partida online: «Jugar en local» junto a «Otra partida» (que pasa a ser la revancha)
  function pintarFinOnline() {
    const b = botonOtra(); if (!b || document.getElementById("online-local")) return;
    const l = document.createElement("button");
    l.className = "btn sec"; l.id = "online-local"; l.dataset.act = "jugar"; l.textContent = "Jugar en local";
    if (b.parentNode) b.parentNode.insertBefore(l, b);
  }
  function limpiarFinOnline() {
    pararEspera(); lineaRevancha("");
    const l = document.getElementById("online-local"); if (l) l.remove();
  }
  function pararEspera() {
    REV.esperando = false; clearInterval(REV.sondeo); clearTimeout(REV.caduca); REV.sondeo = REV.caduca = null;
    botonOtraListo(true);
  }
  async function entrarEnRevancha(id) {
    if (REV.entrando || !despedida) return;
    REV.entrando = true;
    const { sb, yo } = despedida;
    pararEspera(); lineaRevancha("Empieza la revancha…");
    try { await window.PartidaOnline.entrar(sb, id, yo); limpiarFinOnline(); }
    catch (e) { lineaRevancha("No se pudo entrar en la revancha: " + ((e && e.message) || "sin conexión")); }
    REV.entrando = false;
  }
  async function pedirRevancha() {
    if (REV.esperando || REV.entrando) return;
    if (!despedida) {
      if (actual) toast("Espera a que el servidor confirme el resultado.");
      else lineaRevancha("Ya no se puede pedir la revancha de esta partida (han pasado más de 10 minutos o has salido).");
      return;
    }
    const p = despedida.puente;
    botonOtraListo(false); lineaRevancha("Esperando a tu rival…");
    let r;
    try { r = await p.pedirRevancha(); }
    catch (e) { botonOtraListo(true); lineaRevancha(textoErr(e)); return; }
    if (r && r.estado === "creada") { p.avisarRevancha({ tipo: "creada", match: r.match_id }); entrarEnRevancha(r.match_id); return; }
    // esperando: aviso al rival, sondeo por si el aviso se pierde y caducidad
    REV.esperando = true;
    botonOtraListo(false);
    p.avisarRevancha({ tipo: "pedida" });
    REV.sondeo = setInterval(async () => { const m = await p.buscarRevancha(); if (m && REV.esperando) entrarEnRevancha(m.id); }, 2000);
    REV.caduca = setTimeout(async () => {
      const m = await p.buscarRevancha();
      if (m) { entrarEnRevancha(m.id); return; }
      pararEspera(); lineaRevancha("La revancha ha caducado.");
    }, ((r && +r.segundos) || 120) * 1000);
  }
  function alRevanchaRival(p) {
    if (p.tipo === "creada" && p.match) { entrarEnRevancha(p.match); return; }
    if (p.tipo === "pedida" && !REV.esperando) { lineaRevancha("Tu rival quiere la revancha: pulsa «Otra partida»."); REV.lineaRival = true; }
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
    const b = e.target && e.target.closest && e.target.closest('#s-fin [data-act="volver"], #s-fin [data-act="otra"], #s-fin #online-local');
    // también después de cerrar el canal (10 min): en el final de una partida online, «Otra partida» nunca es local
    if (!b || !(despedida || actual || (typeof estado !== "undefined" && estado.online))) return;
    if (b.dataset.act === "otra") {
      // «Otra partida» online es la revancha: el juego no arranca una partida local
      e.stopImmediatePropagation(); e.preventDefault();
      pedirRevancha(); return;
    }
    const local = b.id === "online-local";
    despedirse(local ? "local" : "cuartel");
    limpiarFinOnline();
  }, true);

  async function entrar(sb, matchId, yoUid) {
    if (!actual || actual.matchId !== matchId) {
      cerrarDespedida();
      Object.assign(AVISO, { mostrado: false, pendiente: null });
      const av = document.getElementById("online-aviso-salida"); if (av) av.classList.add("oculto");
    }
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
      alRevancha: alRevanchaRival,
      alAccion: () => window.PartidaOnline.actividad(),   // la exportada (las pruebas pueden sustituirla)
    });
    try { await puente.arrancar(); }
    catch (e) { puente.parar(); throw e; }   // si el arranque falla, no quedan abiertos el canal de Realtime ni los intervalos
    const ini = puente.inicio();
    if (!ini) { puente.parar(); throw { message: "La partida todavía no ha empezado" }; }
    const orden = ini.payload.players || ids;
    const jugadores = orden.map(id => ({ id, nombre: nombre(id) }));
    const yo = orden.indexOf(yoUid);
    if (yo < 0) { puente.parar(); throw { message: "No juegas en esta partida" }; }
    actual = { matchId, yoUid, jugadores, puente, sb };
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

  // ───────────────────────────── Actividad: solo los botones de acción
  // Cuentan: el botón principal (Responder, Tirar dado, Terminar despliegue), «Continuar» de la revisión y los botones
  // de las cartas (continuar, aceptar, rechazar, me presento, salir de servicio…). Las jugadas que se anotan
  // (responder, comodín, comprar, elegir objetivo, desplegar…) cuentan además desde el puente (alAccion).
  // No cuentan: arrastrar o ampliar el tablero, desplazarse, tocar una zona vacía, abrir fichas o listas.
  const SEL_ACCION = "#btn-accion, #preg-seguir, #carta-pie button";
  const ACT = { local: 0, inicioTurno: 0, eraMio: false, perdido: false, autoPerder: true };
  function actividad() {
    ACT.local = Date.now();
    ocultarAviso();
    if (actual) actual.puente.actividad();
  }
  function toque() { if (actual) actual.puente.toque(); }
  document.addEventListener("click", e => {
    const b = e.target && e.target.closest && e.target.closest(SEL_ACCION);
    if (b && !b.disabled) actividad();
  }, { capture: true });
  ["pointerdown", "keydown", "touchstart", "wheel"].forEach(t => document.addEventListener(t, toque, { capture: true, passive: true }));
  function avisoInactividad(n) {
    barra();                                                     // crea también los estilos
    let a = document.getElementById("online-inactivo");
    if (!a) { a = document.createElement("div"); a.id = "online-inactivo"; a.setAttribute("role", "alert"); document.body.appendChild(a); }
    a.classList.remove("oculto");
    a.innerHTML = `Vas a perder por inactividad en ${n}…<small>Pulsa un botón de la partida para seguir jugando</small>`;
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
    if ((mio || (velo && velo.dataset.mia === "1")) && velo && velo.classList.contains("on")) {
      if (pie && [...pie.children].some(x => !x.disabled && x.onclick)) return true;   // carta de tu turno (o tu convocatoria) esperando tu botón
      if (ex && ex.onclick) return true;                         // elegir en una lista (comisaría, lanzar, recolocar)
    }
    if (mio && estado.fase === "despliegue") return true;
    return false;
  }

  window.PartidaOnline = { entrar, crearPuente, actual: () => actual, actividad, despedirse, pedirRevancha, SEL_ACCION, _rev: () => ({ despedida: !!despedida, esperando: REV.esperando, entrando: REV.entrando }), _act: ACT, _necesitoActuar: necesitoActuar };
})();
