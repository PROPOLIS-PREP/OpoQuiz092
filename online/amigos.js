// Amigos online de Patrullan2 (v2, fase 2): buscar por nombre de agente exacto, solicitudes recibidas y enviadas,
// lista de amigos, bloqueados y ficha de cada jugador con «Bloquear». Se actualiza solo con Realtime.
// Lo pinta online/cuenta.js en la pestaña «Amigos» de «Cuenta online»; la pantalla de amigos del modo local no cambia.
// Solo usa RPCs existentes: send_friend_request, respond_friend_request, remove_friend y block_user.
// Lee friendships (cada uno solo ve sus filas, por RLS) y las columnas públicas de profiles.
(function () {
  "use strict";

  // ───────────────────────────── Utilidades puras (se prueban con Node)
  const RE_NOMBRE = /^[A-Za-z0-9_]{3,20}$/;

  // Patrón ILIKE que solo encaja con el nombre exacto (sin distinguir mayúsculas): el _ es comodín en LIKE.
  function patronExacto(nombre) {
    nombre = String(nombre || "").trim();
    return RE_NOMBRE.test(nombre) ? nombre.replace(/_/g, "\\_") : null;
  }

  // Reparte las filas de friendships según el papel del usuario. Un bloqueo que me han hecho a mí no se muestra.
  function clasificar(filas, yo) {
    const r = { recibidas: [], enviadas: [], amigos: [], bloqueados: [], porUsuario: {} };
    for (const f of filas || []) {
      const otro = f.requester_id === yo ? f.addressee_id : f.requester_id;
      let tipo = null;
      if (f.status === "pending") tipo = f.addressee_id === yo ? "recibida" : "enviada";
      else if (f.status === "accepted") tipo = "amigo";
      else if (f.status === "blocked" && f.requester_id === yo) tipo = "bloqueado";
      if (!tipo) continue;
      const item = { id: f.id, otro, tipo, creada: f.created_at };
      r[{ recibida: "recibidas", enviada: "enviadas", amigo: "amigos", bloqueado: "bloqueados" }[tipo]].push(item);
      r.porUsuario[otro] = item;
    }
    return r;
  }

  // Los errores de las RPC ya vienen en español (raise exception … → código P0001).
  function mensajeError(e, traducir) {
    if (e && e.code === "P0001" && e.message) return e.message.replace(/\.?$/, ".");
    return traducir ? traducir(e) : "No se pudo completar. Inténtalo de nuevo.";
  }

  const util = { patronExacto, clasificar, mensajeError };
  if (typeof module !== "undefined" && module.exports) { module.exports = util; return; }

  // ───────────────────────────── Estado
  const st = {
    sb: null, yo: null, cont: null, canal: null,
    filas: [], perfiles: {}, rel: clasificar([], null),
    cargado: false, cargando: false,
    busca: "", hallado: undefined,   // undefined: sin buscar · null: no existe · objeto: perfil encontrado
    ficha: null,                      // id del jugador cuya ficha está abierta
    confirmar: "",                    // "bloquear" | "eliminar" mientras se pide confirmación en la ficha
    msg: "", msgTipo: "", ocupado: false,
  };
  let temporizador = null;
  const esc = s => window.CuentaOnline.util.esc(s);
  const traducir = e => window.CuentaOnline.util.traducirError(e);
  const aviso = (t, tipo) => { st.msg = t || ""; st.msgTipo = tipo || "error"; };

  async function cargar() {
    if (!st.sb || !st.yo) return;
    st.cargando = true;
    try {
      const { data: filas, error } = await st.sb.from("friendships")
        .select("id, requester_id, addressee_id, status, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      st.filas = filas || [];
      st.rel = clasificar(st.filas, st.yo);
      const ids = Object.keys(st.rel.porUsuario).filter(id => !st.perfiles[id]);
      if (ids.length) {
        const { data: ps, error: e2 } = await st.sb.from("profiles").select("id, username, display_name").in("id", ids);
        if (e2) throw e2;
        (ps || []).forEach(p => { st.perfiles[p.id] = p; });
      }
      st.cargado = true;
    } catch (e) { aviso(mensajeError(e, traducir)); }
    st.cargando = false;
    pintarSiVisible();
  }
  // Realtime avisa de cada cambio en friendships: se recarga la lista (agrupando avisos seguidos).
  function recargarPronto() { clearTimeout(temporizador); temporizador = setTimeout(cargar, 250); }

  function montar(sb, yo) {
    if (st.yo === yo && st.canal) return;
    desmontar();
    Object.assign(st, { sb, yo, filas: [], perfiles: {}, rel: clasificar([], yo), cargado: false, busca: "", hallado: undefined, ficha: null, confirmar: "", msg: "" });
    st.canal = sb.channel("amigos-" + yo)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, recargarPronto)
      .subscribe();
    cargar();
  }
  function desmontar() {
    clearTimeout(temporizador);
    if (st.canal && st.sb) { try { st.sb.removeChannel(st.canal); } catch (e) { /* sin conexión: da igual */ } }
    st.canal = null; st.yo = null; st.cont = null;
  }

  // ───────────────────────────── Vistas
  const nombre = id => (st.perfiles[id] && st.perfiles[id].username) || "…";
  const dis = () => st.ocupado ? " disabled" : "";
  const htmlMsg = () => st.msg ? `<div class="cuenta-msg ${st.msgTipo}" role="${st.msgTipo === "error" ? "alert" : "status"}">${esc(st.msg)}</div>` : "";
  const botonNombre = id => `<button class="amigo-nombre" data-am="ficha" data-id="${esc(id)}">${esc(nombre(id))}</button>`;

  function seccion(tit, lista, acciones, vacio) {
    return `<div class="tarjeta"><h3 class="amigos-tit">${tit} <span>${lista.length}</span></h3>${
      lista.length ? `<ul class="amigos-lista">${lista.map(it => `<li>${botonNombre(it.otro)}<span class="amigo-acc">${acciones(it)}</span></li>`).join("")}</ul>`
                   : `<p class="cuenta-letra">${vacio}</p>`}</div>`;
  }

  function vistaFicha() {
    const id = st.ficha, it = st.rel.porUsuario[id], p = st.perfiles[id] || {};
    const b = (am, txt, color, extra = "") => `<button class="btn ${color} peq" data-am="${am}" data-id="${esc(it ? it.id : id)}"${extra}${dis()}>${txt}</button>`;
    let estado, acc = "";
    if (st.confirmar === "bloquear") {
      estado = `¿Bloquear a <b>${esc(p.username)}</b>? Se borrará vuestra amistad o solicitud y no podrá enviarte otra.`;
      acc = `<button class="btn rojo peq" data-am="bloquear" data-id="${esc(id)}"${dis()}>Sí, bloquear</button>${b("no", "Cancelar", "sec")}`;
    } else if (st.confirmar === "eliminar") {
      estado = `¿Eliminar a <b>${esc(p.username)}</b> de tus amigos?`;
      acc = `${b("eliminar", "Sí, eliminar", "rojo")}${b("no", "Cancelar", "sec")}`;
    } else {
      const tipo = it ? it.tipo : "ninguna";
      estado = { ninguna: "No sois amigos.", recibida: "Te ha enviado una solicitud de amistad.", enviada: "Le has enviado una solicitud de amistad.",
                 amigo: "Sois amigos.", bloqueado: "Lo tienes bloqueado." }[tipo];
      if (tipo === "ninguna") acc = `<button class="btn verde peq" data-am="enviar" data-id="${esc(p.username)}"${dis()}>Enviar solicitud</button>`;
      if (tipo === "recibida") acc = b("aceptar", "Aceptar", "verde") + b("rechazar", "Rechazar", "sec");
      if (tipo === "enviada") acc = b("cancelar", "Cancelar solicitud", "sec");
      if (tipo === "amigo") acc = `<button class="btn sec peq" data-am="pedir" data-id="eliminar"${dis()}>Eliminar amigo</button>`;
      if (tipo === "bloqueado") acc = b("desbloquear", "Desbloquear", "azul");
      else acc += `<button class="btn rojo peq" data-am="pedir" data-id="bloquear"${dis()}>Bloquear</button>`;
    }
    return `<div class="tarjeta amigo-ficha">
  <h3 style="margin:0 0 4px">${esc(p.username || "Agente")}</h3>
  ${p.display_name && p.display_name !== p.username ? `<p class="cuenta-letra" style="margin:0 0 6px">${esc(p.display_name)}</p>` : ""}
  <p style="margin:0 0 8px">${estado}</p>
  ${htmlMsg()}
  <div class="cuenta-botones">${acc}</div>
  <div class="cuenta-botones"><button class="btn sec peq" data-am="cerrar">Volver a la lista</button></div>
</div>`;
  }

  function vistaListas() {
    const r = st.rel;
    let busq = "";
    if (st.hallado === null) busq = `<p class="cuenta-letra">No hay ningún agente con ese nombre.</p>`;
    else if (st.hallado && st.hallado.id === st.yo) busq = `<p class="cuenta-letra">Ese eres tú.</p>`;
    else if (st.hallado) busq = `<ul class="amigos-lista"><li>${botonNombre(st.hallado.id)}<span class="amigo-acc"><button class="btn azul peq" data-am="ficha" data-id="${esc(st.hallado.id)}">Ver</button></span></li></ul>`;
    return `
<div class="tarjeta">
  <form class="cuenta-form" data-am-form="buscar" novalidate>
    <label for="am-busca">Buscar agente por su nombre exacto</label>
    <div class="campo"><input id="am-busca" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(st.busca)}" placeholder="p. ej. agente_1a2b3c4d">
    <button class="btn azul peq" type="submit"${dis()}>Buscar</button></div>
  </form>
  ${busq}
  ${htmlMsg()}
</div>
${!st.cargado ? `<div class="tarjeta centrar">${st.cargando ? "Cargando tus amigos…" : `<button class="btn azul peq" data-am="recargar">Reintentar</button>`}</div>` : `
${seccion("Recibidas", r.recibidas, it => `<button class="btn verde peq" data-am="aceptar" data-id="${it.id}"${dis()}>Aceptar</button><button class="btn sec peq" data-am="rechazar" data-id="${it.id}"${dis()}>Rechazar</button>`, "No tienes solicitudes pendientes.")}
${seccion("Amigos", r.amigos, it => `<button class="btn sec peq" data-am="ficha" data-id="${esc(it.otro)}">Ver</button>`, "Aún no tienes amigos online. Busca a alguien por su nombre de agente.")}
${seccion("Enviadas", r.enviadas, it => `<button class="btn sec peq" data-am="cancelar" data-id="${it.id}"${dis()}>Cancelar</button>`, "No tienes solicitudes enviadas.")}
${seccion("Bloqueados", r.bloqueados, it => `<button class="btn azul peq" data-am="desbloquear" data-id="${it.id}"${dis()}>Desbloquear</button>`, "No has bloqueado a nadie.")}`}`;
  }

  function pintar(cont) {
    st.cont = cont;
    cont.innerHTML = st.ficha ? vistaFicha() : vistaListas();
  }
  function pintarSiVisible() {
    if (st.cont && document.body.contains(st.cont) && !st.cont.closest(".oculto")) pintar(st.cont);
  }

  // ───────────────────────────── Acciones
  async function ejecutar(fn, okMsg) {
    if (st.ocupado) return;
    st.ocupado = true; aviso(""); pintarSiVisible();
    try { await fn(); if (okMsg) aviso(okMsg, "ok"); st.confirmar = ""; await cargar(); }
    catch (e) { aviso(mensajeError(e, traducir)); }
    st.ocupado = false; pintarSiVisible();
  }
  const rpc = async (f, args) => { const { data, error } = await st.sb.rpc(f, args); if (error) throw error; return data; };

  async function buscar(texto) {
    st.busca = String(texto || "").trim(); st.hallado = undefined; st.ficha = null;
    const patron = patronExacto(st.busca);
    if (!patron) { aviso("Escribe el nombre de agente completo: de 3 a 20 letras sin tilde, números o _."); pintarSiVisible(); return; }
    await ejecutar(async () => {
      const { data, error } = await st.sb.from("profiles").select("id, username, display_name").ilike("username", patron).limit(1);
      if (error) throw error;
      st.hallado = (data && data[0]) || null;
      if (st.hallado) st.perfiles[st.hallado.id] = st.hallado;
    });
  }

  // que: acción del botón · id: según la acción, id de la fila de friendships, id del jugador o nombre de agente
  function accion(que, id) {
    switch (que) {
      case "ficha": st.ficha = id; st.confirmar = ""; aviso(""); pintarSiVisible(); return;
      case "cerrar": st.ficha = null; st.confirmar = ""; aviso(""); pintarSiVisible(); return;
      case "pedir": st.confirmar = id; aviso(""); pintarSiVisible(); return;
      case "no": st.confirmar = ""; pintarSiVisible(); return;
      case "recargar": aviso(""); cargar(); return;
      case "enviar": {
        let enviada = false;
        return ejecutar(async () => {
          await rpc("send_friend_request", { p_username: id });
          enviada = true; st.hallado = undefined; st.busca = "";
        }, "Solicitud enviada.").then(() => {
          // si el otro ya nos la había enviado, send_friend_request la deja aceptada
          const it = enviada && st.ficha && st.rel.porUsuario[st.ficha];
          if (it && it.tipo === "amigo") { aviso("¡Ya sois amigos! Esa persona también te había enviado una solicitud.", "ok"); pintarSiVisible(); }
        });
      }
      case "aceptar": return ejecutar(() => rpc("respond_friend_request", { p_id: +id, p_accept: true }), "Solicitud aceptada.");
      case "rechazar": return ejecutar(() => rpc("respond_friend_request", { p_id: +id, p_accept: false }), "Solicitud rechazada.");
      case "cancelar": return ejecutar(() => rpc("remove_friend", { p_id: +id }), "Solicitud cancelada.");
      case "eliminar": return ejecutar(() => rpc("remove_friend", { p_id: +id }), "Amigo eliminado.");
      case "desbloquear": return ejecutar(() => rpc("remove_friend", { p_id: +id }), "Desbloqueado.");
      case "bloquear": return ejecutar(() => rpc("block_user", { p_user: id }), "Bloqueado.");
    }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("#s-cuenta [data-am]");
    if (!b || b.disabled) return;
    accion(b.dataset.am, b.dataset.id);
  });
  document.addEventListener("submit", e => {
    const f = e.target.closest && e.target.closest("#s-cuenta [data-am-form]");
    if (!f) return;
    e.preventDefault();
    buscar((document.getElementById("am-busca") || {}).value);
  });

  const CSS = `
#s-cuenta .amigos-tit{margin:0 0 6px;display:flex;justify-content:space-between;align-items:baseline}
#s-cuenta .amigos-tit span{font-size:14px;opacity:.7}
#s-cuenta .amigos-lista{list-style:none;margin:0;padding:0}
#s-cuenta .amigos-lista li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #ead9b8;flex-wrap:wrap}
#s-cuenta .amigos-lista li:first-child{border-top:none}
#s-cuenta .amigo-nombre{font-weight:800;font-size:16px;text-decoration:underline;text-underline-offset:3px;padding:6px 0;min-height:36px;text-align:left;word-break:break-all;color:inherit}
#s-cuenta .amigo-acc{display:flex;gap:6px;flex-wrap:wrap}
#s-cuenta .campo{display:flex;gap:8px;align-items:center}`;
  if (!document.getElementById("amigos-css")) {
    const s = document.createElement("style"); s.id = "amigos-css"; s.textContent = CSS; document.head.appendChild(s);
  }

  window.AmigosOnline = { montar, desmontar, pintar, util, _accion: accion, _buscar: buscar, _estado: st };
})();
