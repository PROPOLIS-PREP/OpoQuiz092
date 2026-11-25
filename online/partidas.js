// Partidas online de Patrullan2 (v2, subfase 3a): lobby 1 contra 1 por código de 5 letras.
// Crear partida para un amigo, unirse con código, sala de espera en tiempo real, salir y lista de mis partidas.
// Todavía NO se empieza a jugar: «Empezar» está desactivado y la app no llama a start_match (llega en la 3c).
// Solo usa RPCs existentes: create_match, join_match y leave_match. Lee matches, match_players,
// friendships y profiles (RLS: cada uno solo ve sus partidas y sus amistades).
//
// Reglas que controla SOLO la app (pendientes de backend, ver docs/backend-v2.md):
//   · máximo 3 partidas simultáneas por jugador (en sala de espera o en curso);
//   · solo se crean partidas para jugar contra un amigo;
//   · las salas de espera de más de 30 minutos se cierran (cada jugador sale al abrir la lista).
(function () {
  "use strict";

  // ───────────────────────────── Utilidades puras (se prueban con Node)
  const LIMITE = 3;
  const CADUCA_MS = 30 * 60 * 1000;
  const TURNOS = [5, 10, 15];
  const TURNOS_DEFECTO = 10;
  const RE_CODIGO = /^[A-HJKMNP-Z2-9]{5}$/;

  const normalizarCodigo = c => String(c || "").replace(/\s+/g, "").toUpperCase();
  const codigoValido = c => RE_CODIGO.test(normalizarCodigo(c));
  const turnosValidos = t => TURNOS.includes(+t) ? +t : TURNOS_DEFECTO;
  const caducada = (m, ahora) => m.status === "lobby" && ahora - Date.parse(m.created_at) > CADUCA_MS;

  // Reparte mis partidas: las que cuentan (sala de espera vigente o en curso) y las salas caducadas.
  function repartir(partidas, ahora) {
    const activas = [], caducadas = [];
    for (const m of partidas || []) {
      if (m.status === "lobby" && caducada(m, ahora)) caducadas.push(m);
      else if (m.status === "lobby" || m.status === "in_progress") activas.push(m);
    }
    return { activas, caducadas, lleno: activas.length >= LIMITE };
  }
  // ¿Puedo entrar en otra partida? (si ya estoy en ella, sí: join_match devuelve la misma)
  const puedoEntrar = (activas, matchId) => activas.length < LIMITE || activas.some(m => m.id === matchId);

  function minutosRestantes(m, ahora) {
    return Math.max(0, Math.ceil((Date.parse(m.created_at) + CADUCA_MS - ahora) / 60000));
  }

  const util = { LIMITE, CADUCA_MS, TURNOS, TURNOS_DEFECTO, normalizarCodigo, codigoValido, turnosValidos, caducada, repartir, puedoEntrar, minutosRestantes };
  if (typeof module !== "undefined" && module.exports) { module.exports = util; return; }

  // ───────────────────────────── Estado
  const st = {
    sb: null, yo: null, cont: null, canal: null, reloj: null,
    partidas: [], jugadores: {}, perfiles: {}, amigos: new Set(),
    cargado: false, cargando: false,
    vista: "lista",            // "lista" | "crear" | "unirse" | "sala"
    sala: null,                // id de la partida abierta
    amigoElegido: "", turnos: TURNOS_DEFECTO, codigo: "",
    confirmar: false,          // confirmación de «Abandonar» en una partida en curso
    msg: "", msgTipo: "", ocupado: false,
  };
  let temporizador = null;
  const LS_PARA = "patrullan2_partida_para"; // { match_id: id del amigo invitado } (solo para mostrar «para X»)
  const leerPara = () => { try { return JSON.parse(localStorage.getItem(LS_PARA) || "{}"); } catch (e) { return {}; } };
  const guardarPara = (id, amigo) => { try { const p = leerPara(); p[id] = amigo; localStorage.setItem(LS_PARA, JSON.stringify(p)); } catch (e) { /* sin almacenamiento: solo se pierde el «para X» */ } };

  const esc = s => window.CuentaOnline.util.esc(s);
  const traducir = e => window.CuentaOnline.util.traducirError(e);
  const mensajeError = e => (e && e.code === "P0001" && e.message) ? e.message.replace(/\.?$/, ".") : traducir(e);
  const aviso = (t, tipo) => { st.msg = t || ""; st.msgTipo = tipo || "error"; };
  const rpc = async (f, args) => { const { data, error } = await st.sb.rpc(f, args); if (error) throw error; return data; };

  async function cargar() {
    if (!st.sb || !st.yo) return;
    st.cargando = true;
    try {
      const { data: ms, error } = await st.sb.from("matches")
        .select("id, code, host_id, status, mode, max_players, turns, created_at, started_at")
        .in("status", ["lobby", "in_progress"]).order("created_at", { ascending: false });
      if (error) throw error;
      const r = repartir(ms, Date.now());
      // salas de espera de más de 30 minutos: salgo de ellas (cuando salen todos, la sala se borra)
      for (const m of r.caducadas) { try { await rpc("leave_match", { p_match: m.id }); } catch (e) { /* se reintentará */ } }
      st.partidas = r.activas;
      const ids = st.partidas.map(m => m.id);
      st.jugadores = {};
      if (ids.length) {
        const { data: js, error: e2 } = await st.sb.from("match_players").select("match_id, user_id, seat, forfeited").in("match_id", ids).order("seat");
        if (e2) throw e2;
        (js || []).forEach(j => (st.jugadores[j.match_id] = st.jugadores[j.match_id] || []).push(j));
      }
      const { data: fs, error: e3 } = await st.sb.from("friendships").select("requester_id, addressee_id").eq("status", "accepted");
      if (e3) throw e3;
      st.amigos = new Set((fs || []).map(f => f.requester_id === st.yo ? f.addressee_id : f.requester_id));
      const faltan = [...new Set([...st.amigos, ...Object.values(st.jugadores).flat().map(j => j.user_id)])].filter(id => !st.perfiles[id]);
      if (faltan.length) {
        const { data: ps, error: e4 } = await st.sb.from("profiles").select("id, username").in("id", faltan);
        if (e4) throw e4;
        (ps || []).forEach(p => { st.perfiles[p.id] = p; });
      }
      if (st.vista === "sala" && !st.partidas.some(m => m.id === st.sala)) {
        st.vista = "lista"; st.sala = null;
        if (!st.msg) aviso("La sala ya no existe: se cerró o saliste de ella.", "ok");
      }
      st.cargado = true;
    } catch (e) { aviso(mensajeError(e)); }
    st.cargando = false;
    pintarSiVisible();
  }
  function recargarPronto() { clearTimeout(temporizador); temporizador = setTimeout(cargar, 250); }

  function montar(sb, yo) {
    if (st.yo === yo && st.canal) return;
    desmontar();
    Object.assign(st, { sb, yo, partidas: [], jugadores: {}, perfiles: {}, amigos: new Set(), cargado: false, vista: "lista", sala: null, msg: "", confirmar: false });
    // Realtime: cualquier cambio en mis partidas o en sus jugadores recarga la lista (los DELETE llegan sin filtrar).
    st.canal = sb.channel("partidas-" + yo)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, recargarPronto)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_players" }, recargarPronto)
      .subscribe();
    // respaldo por si se pierde algún aviso, y para cerrar salas caducadas y actualizar los minutos
    st.reloj = setInterval(() => { if (st.cont && document.body.contains(st.cont) && !st.cont.closest(".oculto")) cargar(); }, 15000);
    cargar();
  }
  function desmontar() {
    clearTimeout(temporizador); clearInterval(st.reloj); st.reloj = null;
    if (st.canal && st.sb) { try { st.sb.removeChannel(st.canal); } catch (e) { /* sin conexión */ } }
    st.canal = null; st.yo = null; st.cont = null;
  }

  // ───────────────────────────── Vistas
  const nombre = id => (st.perfiles[id] && st.perfiles[id].username) || "…";
  const dis = () => st.ocupado ? " disabled" : "";
  const htmlMsg = () => st.msg ? `<div class="cuenta-msg ${st.msgTipo}" role="${st.msgTipo === "error" ? "alert" : "status"}">${esc(st.msg)}</div>` : "";
  const boton = (pa, txt, color, id = "", extra = "") => `<button class="btn ${color} peq" data-pa="${pa}" data-id="${esc(id)}"${extra}${dis()}>${txt}</button>`;

  function vistaLista() {
    const n = st.partidas.length, lleno = n >= LIMITE;
    const filas = st.partidas.map(m => {
      const js = st.jugadores[m.id] || [], rival = js.find(j => j.user_id !== st.yo), para = leerPara()[m.id];
      const quien = rival ? `contra <b>${esc(nombre(rival.user_id))}</b>` : para ? `esperando a <b>${esc(nombre(para))}</b>` : "esperando rival";
      const estado = m.status === "lobby" ? `Sala de espera · ${minutosRestantes(m, Date.now())} min` : "En curso";
      return `<li><span><b class="partida-cod">${esc(m.code)}</b> ${quien}<br><span class="cuenta-letra">${estado} · ${m.turns} turnos</span></span>
        <span class="amigo-acc">${boton("abrir", "Abrir", "azul", m.id)}</span></li>`;
    }).join("");
    return `
<div class="tarjeta">
  <h3 class="amigos-tit">Mis partidas <span>${n}/${LIMITE}</span></h3>
  ${n ? `<ul class="amigos-lista">${filas}</ul>` : `<p class="cuenta-letra">No tienes partidas online. Crea una para un amigo o únete con el código que te pase.</p>`}
  ${lleno ? `<p class="cuenta-letra">Has llegado al máximo de ${LIMITE} partidas a la vez. Sal de alguna para crear o unirte a otra.</p>` : ""}
  ${htmlMsg()}
  <div class="cuenta-botones">${boton("vista", "Crear partida", "verde", "crear", lleno ? " disabled" : "")}${boton("vista", "Unirme con código", "azul", "unirse", lleno ? " disabled" : "")}</div>
</div>
<p class="nota">Partidas 1 contra 1 · modo «Por puntos». Las salas de espera se cierran a los 30 minutos.</p>`;
  }

  function vistaCrear() {
    const amigos = [...st.amigos].sort((a, b) => nombre(a).localeCompare(nombre(b)));
    if (!amigos.length) return `<div class="tarjeta"><h3 style="margin:0 0 6px">Crear partida</h3>
      <p>Para crear una partida necesitas al menos un amigo online. Añádelo en la pestaña «Amigos».</p>
      <div class="cuenta-botones">${boton("vista", "Volver", "sec", "lista")}</div></div>`;
    return `<div class="tarjeta">
  <h3 style="margin:0 0 6px">Crear partida</h3>
  <form class="cuenta-form" data-pa-form="crear" novalidate>
    <label for="pa-amigo">¿Contra qué amigo?</label>
    <select id="pa-amigo" class="pa-select">${amigos.map(id => `<option value="${esc(id)}"${id === st.amigoElegido ? " selected" : ""}>${esc(nombre(id))}</option>`).join("")}</select>
    <span>Turnos</span>
    <div class="ops-sel pa-turnos" role="group" aria-label="Número de turnos">${TURNOS.map(t => `<button type="button" class="sel${t === st.turnos ? " on" : ""}" data-pa="turnos" data-id="${t}" aria-pressed="${t === st.turnos}">${t}</button>`).join("")}</div>
    <span class="cuenta-letra">Modo «Por puntos». Al crearla verás un código de 5 letras para pasárselo a tu amigo.</span>
    ${htmlMsg()}
    <div class="cuenta-botones"><button class="btn verde peq" type="submit"${dis()}>${st.ocupado ? "Creando…" : "Crear y ver código"}</button>${boton("vista", "Cancelar", "sec", "lista")}</div>
  </form>
</div>`;
  }

  function vistaUnirse() {
    return `<div class="tarjeta">
  <h3 style="margin:0 0 6px">Unirme a una partida</h3>
  <form class="cuenta-form" data-pa-form="unirse" novalidate>
    <label for="pa-codigo">Código de la partida</label>
    <input id="pa-codigo" class="pa-codigo-in" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(st.codigo)}" placeholder="ABCDE">
    <span class="cuenta-letra">5 letras o números (sin I, L, O, 0 ni 1).</span>
    ${htmlMsg()}
    <div class="cuenta-botones"><button class="btn verde peq" type="submit"${dis()}>${st.ocupado ? "Entrando…" : "Unirme"}</button>${boton("vista", "Cancelar", "sec", "lista")}</div>
  </form>
</div>`;
  }

  function vistaSala() {
    const m = st.partidas.find(x => x.id === st.sala);
    if (!m) return vistaLista();
    const js = st.jugadores[m.id] || [], soyHost = m.host_id === st.yo, para = leerPara()[m.id];
    const filas = js.map(j => {
      const yo = j.user_id === st.yo, amigo = st.amigos.has(j.user_id);
      const marca = yo ? "tú" : amigo ? "✓ amigo" : "⚠ no es tu amigo";
      return `<li><span><b>${esc(nombre(j.user_id))}</b>${j.user_id === m.host_id ? " · anfitrión" : ""}</span><span class="cuenta-letra">${marca}</span></li>`;
    }).join("");
    const extrano = js.some(j => j.user_id !== st.yo && !st.amigos.has(j.user_id));
    if (m.status === "in_progress") return `<div class="tarjeta">
  <h3 style="margin:0 0 6px">Partida ${esc(m.code)} · en curso</h3>
  <ul class="amigos-lista">${filas}</ul>
  <p class="cuenta-letra">El tablero online llegará en la próxima versión.</p>
  ${htmlMsg()}
  <div class="cuenta-botones">${st.confirmar
      ? `${boton("abandonar", "Sí, abandonar (pierdes la partida)", "rojo", m.id)}${boton("noabandonar", "Cancelar", "sec")}`
      : `${boton("pedirabandono", "Abandonar", "rojo")}`}${boton("vista", "Volver a la lista", "sec", "lista")}</div>
</div>`;
    return `<div class="tarjeta">
  <h3 style="margin:0 0 6px">Sala de espera</h3>
  <p class="centrar" style="margin:0 0 4px">Código de la partida</p>
  <p class="centrar" style="margin:0 0 6px"><span class="codigo">${esc(m.code)}</span></p>
  <p class="cuenta-letra centrar">${soyHost && para ? `Pásaselo a <b>${esc(nombre(para))}</b> para que se una.` : soyHost ? "Pásaselo a tu amigo para que se una." : "Esperando a que el anfitrión empiece."}
    ${m.turns} turnos · se cierra en ${minutosRestantes(m, Date.now())} min.</p>
  <h3 class="amigos-tit">Jugadores <span>${js.length}/${m.max_players}</span></h3>
  <ul class="amigos-lista">${filas}</ul>
  ${extrano ? `<p class="cuenta-msg error">En la sala hay alguien que no está en tu lista de amigos.${soyHost ? " Sal de la sala y crea otra si no lo conoces." : ""}</p>` : ""}
  ${htmlMsg()}
  <div class="cuenta-botones"><button class="btn verde peq" disabled title="Disponible en la próxima versión">Empezar</button>${boton("salir", "Salir de la sala", "rojo", m.id)}</div>
  <p class="cuenta-letra centrar">«Empezar»: disponible en la próxima versión.</p>
  <div class="cuenta-botones">${boton("vista", "Volver a la lista", "sec", "lista")}</div>
</div>`;
  }

  function pintar(cont) {
    st.cont = cont;
    if (!st.cargado) { cont.innerHTML = `<div class="tarjeta centrar">${st.cargando || !st.msg ? "Cargando tus partidas…" : htmlMsg() + boton("recargar", "Reintentar", "azul")}</div>`; return; }
    cont.innerHTML = { lista: vistaLista, crear: vistaCrear, unirse: vistaUnirse, sala: vistaSala }[st.vista]();
  }
  function pintarSiVisible() {
    if (st.cont && document.body.contains(st.cont) && !st.cont.closest(".oculto")) pintar(st.cont);
  }

  // ───────────────────────────── Acciones
  async function ejecutar(fn) {
    if (st.ocupado) return;
    st.ocupado = true; aviso(""); pintarSiVisible();
    try { await fn(); } catch (e) { aviso(mensajeError(e)); }
    st.ocupado = false; await cargar();
  }

  async function crear(amigo, turnos) {
    st.amigoElegido = amigo; st.turnos = turnosValidos(turnos);
    if (!st.amigos.has(amigo)) { aviso("Elige a uno de tus amigos."); pintarSiVisible(); return; }
    if (!puedoEntrar(st.partidas)) { aviso(`Ya tienes ${LIMITE} partidas a la vez.`); pintarSiVisible(); return; }
    await ejecutar(async () => {
      const data = await rpc("create_match", { p_mode: "points", p_max_players: 2, p_turns: st.turnos });
      const fila = Array.isArray(data) ? data[0] : data;
      guardarPara(fila.match_id, amigo);
      st.sala = fila.match_id; st.vista = "sala";
    });
  }

  async function unirse(codigo) {
    st.codigo = normalizarCodigo(codigo);
    if (!codigoValido(st.codigo)) { aviso("El código tiene 5 letras o números (sin I, L, O, 0 ni 1)."); pintarSiVisible(); return; }
    await ejecutar(async () => {
      // el límite se comprueba con la partida ya identificada: si ya estoy dentro, no cuenta como nueva
      const ya = st.partidas.find(m => m.code === st.codigo);
      if (!ya && !puedoEntrar(st.partidas)) throw { code: "P0001", message: `Ya tienes ${LIMITE} partidas a la vez. Sal de alguna para unirte` };
      const id = await rpc("join_match", { p_code: st.codigo });
      st.codigo = ""; st.sala = id; st.vista = "sala";
    });
  }

  function accion(que, id) {
    switch (que) {
      case "vista": st.vista = id; st.confirmar = false; aviso(""); if (id === "crear" && !st.amigoElegido) st.amigoElegido = [...st.amigos][0] || ""; pintarSiVisible(); return;
      case "abrir": st.sala = id; st.vista = "sala"; st.confirmar = false; aviso(""); pintarSiVisible(); return;
      case "turnos": {
        const sel = document.getElementById("pa-amigo"); if (sel) st.amigoElegido = sel.value;
        st.turnos = turnosValidos(id); pintarSiVisible(); return;
      }
      case "recargar": aviso(""); cargar(); return;
      case "salir": return ejecutar(async () => { await rpc("leave_match", { p_match: id }); st.vista = "lista"; st.sala = null; aviso("Has salido de la sala.", "ok"); });
      case "pedirabandono": st.confirmar = true; pintarSiVisible(); return;
      case "noabandonar": st.confirmar = false; pintarSiVisible(); return;
      case "abandonar": return ejecutar(async () => { await rpc("leave_match", { p_match: id }); st.confirmar = false; st.vista = "lista"; st.sala = null; aviso("Has abandonado la partida.", "ok"); });
    }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("#s-cuenta [data-pa]");
    if (!b || b.disabled) return;
    accion(b.dataset.pa, b.dataset.id);
  });
  document.addEventListener("submit", e => {
    const f = e.target.closest && e.target.closest("#s-cuenta [data-pa-form]");
    if (!f) return;
    e.preventDefault();
    const v = id => (document.getElementById(id) || {}).value || "";
    if (f.dataset.paForm === "crear") crear(v("pa-amigo"), st.turnos);
    else unirse(v("pa-codigo"));
  });

  const CSS = `
#s-cuenta .partida-cod{font-family:var(--display);letter-spacing:.08em}
#s-cuenta .pa-select{border:3px solid var(--tinta);border-radius:11px;padding:8px 10px;font-size:16px;min-height:44px;background:var(--blanco);width:100%;color:var(--tinta)}
#s-cuenta .pa-codigo-in{text-transform:uppercase;letter-spacing:.2em;font-family:var(--display);text-align:center}
#s-cuenta .pa-turnos{display:flex;gap:8px}
#s-cuenta .pa-turnos .sel{flex:1;min-height:44px}`;
  if (!document.getElementById("partidas-css")) {
    const s = document.createElement("style"); s.id = "partidas-css"; s.textContent = CSS; document.head.appendChild(s);
  }

  window.PartidasOnline = { montar, desmontar, pintar, util, _accion: accion, _crear: crear, _unirse: unirse, _estado: st, _cargar: cargar };
})();
