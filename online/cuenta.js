// Cuenta online de Patrullan2 (v2, fase 1): registro, inicio de sesión, perfil y cierre de sesión.
// Se carga solo cuando el jugador entra en «Jugar online / Cuenta» (ver cargarOnline() en index.html),
// así el juego local no depende de este archivo ni de supabase-js.
// Usa: window.supabase (lib/supabase.min.js) y window.PATRULLAN2_ONLINE (online/config.js).
(function () {
  "use strict";

  // ───────────────────────────── Utilidades puras (se prueban con Node)
  const RE_NOMBRE = /^[A-Za-z0-9_]{3,20}$/;
  const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MIN_CLAVE = 6; // mínimo por defecto de Supabase Auth

  function validarNombre(n) {
    n = String(n || "").trim();
    if (!n) return "Escribe un nombre de agente.";
    if (n.length < 3 || n.length > 20) return "El nombre debe tener entre 3 y 20 caracteres.";
    if (!RE_NOMBRE.test(n)) return "Solo letras sin tilde, números y guion bajo (_), sin espacios.";
    return "";
  }
  function validarCorreo(c) {
    return RE_CORREO.test(String(c || "").trim()) ? "" : "Escribe un correo válido.";
  }
  function validarClave(c, repetida, registro) {
    c = String(c || "");
    if (c.length < MIN_CLAVE) return `La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`;
    if (registro && c !== String(repetida || "")) return "Las dos contraseñas no coinciden.";
    return "";
  }
  const GENERICO_REGISTRO = "No se ha podido crear la cuenta. Revisa la contraseña e inténtalo de nuevo.";
  // ¿El rechazo de contraseña de Supabase es solo por longitud? (AuthWeakPasswordError trae reasons: length, characters, pwned)
  function soloLongitud(e, msg) {
    if (Array.isArray(e.reasons) && e.reasons.length) return e.reasons.every(r => r === "length");
    return /at least \d+ characters/i.test(msg);
  }
  // Traduce los errores de Supabase (Auth y PostgREST) a mensajes para el jugador.
  // e.contexto === "registro" (lo pone registrar()): lo que no tenga mensaje propio usa el genérico de registro.
  function traducirError(e) {
    if (!e) return "";
    const cod = String(e.code || ""), msg = String(e.message || e);
    if (cod === "23505") return "Ese nombre de agente ya está en uso. Prueba otro.";
    if (cod === "23514") return "Solo letras sin tilde, números y guion bajo (_), de 3 a 20 caracteres.";
    if (cod === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "Correo o contraseña incorrectos.";
    if (cod === "email_not_confirmed" || /email not confirmed/i.test(msg))
      return "Aún no has confirmado tu correo. Revisa tu bandeja de entrada (y la de spam).";
    if (cod === "user_already_exists" || /already registered/i.test(msg)) return "Ya hay una cuenta con ese correo. Inicia sesión.";
    if (cod === "weak_password" || /password should/i.test(msg))
      return soloLongitud(e, msg) ? `La contraseña debe tener al menos ${(msg.match(/at least (\d+) characters/i) || [])[1] || MIN_CLAVE} caracteres.` : GENERICO_REGISTRO;
    if (cod === "email_address_invalid" || /invalid format|email address .* invalid/i.test(msg)) return "Ese correo no es válido.";
    if (/rate limit|too many|429/i.test(cod + " " + msg) || e.status === 429) return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
    if (cod === "signup_disabled") return "El registro está cerrado en este momento.";
    if (/failed to fetch|network|load failed/i.test(msg)) return "No hay conexión con el servidor. Comprueba tu internet.";
    return e.contexto === "registro" ? GENERICO_REGISTRO : "No se pudo completar. Inténtalo de nuevo.";
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const util = { GENERICO_REGISTRO, validarNombre, validarCorreo, validarClave, traducirError, esc, RE_NOMBRE };
  if (typeof module !== "undefined" && module.exports) { module.exports = util; return; }

  // ───────────────────────────── Cliente y estado
  const cfg = window.PATRULLAN2_ONLINE;
  const sb = window.supabase.createClient(cfg.url, cfg.clave, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "patrullan2_sesion" },
  });

  const st = {
    cont: null,          // contenedor donde se pinta (#cuenta-cont)
    sesion: null,
    perfil: null,
    modo: "entrar",      // "entrar" | "registro"
    enviado: "",         // correo al que se mandó la confirmación
    msg: "", msgTipo: "", // aviso bajo el formulario ("error" | "ok")
    ocupado: false,
    correo: "",          // se conserva al cambiar de pestaña
  };

  function aviso(txt, tipo) { st.msg = txt || ""; st.msgTipo = tipo || "error"; }

  async function cargarPerfil() {
    const { data, error } = await sb.rpc("my_profile");
    if (error) throw error;
    st.perfil = (data && data[0]) || null;
  }

  sb.auth.onAuthStateChange((evento, sesion) => {
    const antes = st.sesion && st.sesion.user.id;
    st.sesion = sesion;
    if (!sesion) { st.perfil = null; pintarSiVisible(); return; }
    if (sesion.user.id !== antes || !st.perfil) {
      // fuera del callback: supabase-js no recomienda llamar a la API dentro de él
      setTimeout(() => cargarPerfil().catch(e => aviso(traducirError(e))).finally(pintarSiVisible), 0);
    }
  });

  function pintarSiVisible() {
    if (st.cont && document.body.contains(st.cont) && !st.cont.closest(".oculto")) pintar(st.cont);
  }

  // ───────────────────────────── Vistas
  const CSS = `
#s-cuenta .cuenta-form{display:grid;gap:8px}
#s-cuenta .cuenta-form label{font-weight:700;font-size:14px;margin-top:4px}
#s-cuenta .cuenta-form input{border:3px solid var(--tinta);border-radius:11px;padding:8px 10px;font-size:16px;min-height:44px;background:var(--blanco);width:100%;box-sizing:border-box}
#s-cuenta .cuenta-msg{border-radius:11px;padding:8px 10px;font-size:14px;line-height:1.35;margin-top:4px}
#s-cuenta .cuenta-msg.error{background:#ffe1e4;border:2px solid #b60928;color:#6d0618}
#s-cuenta .cuenta-msg.ok{background:#e1f8d9;border:2px solid #058513;color:#03420a}
#s-cuenta .cuenta-dato{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:4px 0;font-size:15px}
#s-cuenta .cuenta-dato b{word-break:break-all}
#s-cuenta .cuenta-botones{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:8px}
#s-cuenta .cuenta-letra{font-size:13px;opacity:.8;line-height:1.35}
#s-cuenta .seg button{flex:1}`;
  if (!document.getElementById("cuenta-css")) {
    const s = document.createElement("style"); s.id = "cuenta-css"; s.textContent = CSS; document.head.appendChild(s);
  }

  const htmlMsg = () => st.msg ? `<div class="cuenta-msg ${st.msgTipo}" role="${st.msgTipo === "error" ? "alert" : "status"}">${esc(st.msg)}</div>` : "";
  const volver = `<div class="cuenta-botones"><button class="btn sec peq" data-act="ir" data-id="inicio">Volver al Cuartel</button></div>`;
  const dis = () => st.ocupado ? " disabled" : "";

  function vistaAcceso() {
    const reg = st.modo === "registro";
    return `
<div class="seg" role="tablist">
  <button class="${reg ? "" : "on"}" data-ol="modo" data-id="entrar" role="tab" aria-selected="${!reg}">Entrar</button>
  <button class="${reg ? "on" : ""}" data-ol="modo" data-id="registro" role="tab" aria-selected="${reg}">Crear cuenta</button>
</div>
<div class="tarjeta">
  <form class="cuenta-form" data-ol-form="${reg ? "registro" : "entrar"}" novalidate>
    <label for="ol-correo">Correo</label>
    <input id="ol-correo" type="email" autocomplete="email" inputmode="email" value="${esc(st.correo)}" required>
    <label for="ol-clave">Contraseña</label>
    <input id="ol-clave" type="password" autocomplete="${reg ? "new-password" : "current-password"}" minlength="6" required>
    ${reg ? `<label for="ol-clave2">Repite la contraseña</label>
    <input id="ol-clave2" type="password" autocomplete="new-password" minlength="6" required>` : ""}
    ${htmlMsg()}
    <div class="cuenta-botones"><button class="btn verde" type="submit"${dis()}>${st.ocupado ? "Un momento…" : reg ? "Crear cuenta" : "Entrar"}</button></div>
  </form>
</div>
<p class="nota">La cuenta solo hace falta para jugar online. El juego local sigue disponible sin cuenta.</p>
${volver}`;
  }

  function vistaConfirmar() {
    return `
<div class="tarjeta">
  <h3 style="margin:0 0 6px">Confirma tu correo</h3>
  <p style="margin:0 0 8px">Te hemos enviado un enlace a <b>${esc(st.enviado)}</b>. Ábrelo para activar la cuenta y después inicia sesión.</p>
  <p class="cuenta-letra">Si no lo ves en unos minutos, mira en spam. Si ya existía una cuenta con ese correo, no se crea otra: inicia sesión o recupera la contraseña.</p>
  ${htmlMsg()}
  <div class="cuenta-botones">
    <button class="btn azul peq" data-ol="reenviar"${dis()}>Reenviar correo</button>
    <button class="btn verde peq" data-ol="modo" data-id="entrar">Ya lo he confirmado</button>
  </div>
</div>
${volver}`;
  }

  function vistaPerfil() {
    const p = st.perfil, u = st.sesion.user;
    if (!p) return `<div class="tarjeta centrar">${st.msg ? htmlMsg() : "Cargando tu perfil…"}
      <div class="cuenta-botones"><button class="btn azul peq" data-ol="recargar">Reintentar</button><button class="btn rojo peq" data-ol="salir">Cerrar sesión</button></div></div>${volver}`;
    return `
<div class="tarjeta">
  <h3 style="margin:0 0 6px">Tu perfil online</h3>
  <div class="cuenta-dato"><span>Nombre de agente</span><b>${esc(p.username)}</b></div>
  <div class="cuenta-dato"><span>Correo</span><b>${esc(u.email || "")}</b></div>
  ${p.username_provisional ? `<p class="cuenta-letra">Este nombre es provisional. Elige el tuyo: es como te buscarán tus amigos.</p>` : ""}
  <form class="cuenta-form" data-ol-form="nombre" novalidate>
    <label for="ol-nombre">Cambiar nombre de agente</label>
    <input id="ol-nombre" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(p.username)}" pattern="[A-Za-z0-9_]{3,20}">
    <span class="cuenta-letra">De 3 a 20 caracteres: letras sin tilde, números y guion bajo (_).</span>
    ${htmlMsg()}
    <div class="cuenta-botones"><button class="btn azul peq" type="submit"${dis()}>${st.ocupado ? "Guardando…" : "Guardar nombre"}</button></div>
  </form>
</div>
<div class="cuenta-botones"><button class="btn rojo peq" data-ol="salir"${dis()}>Cerrar sesión</button><button class="btn sec peq" data-act="ir" data-id="inicio">Volver al Cuartel</button></div>`;
  }

  function pintar(cont) {
    st.cont = cont;
    cont.innerHTML = st.sesion ? vistaPerfil() : st.enviado ? vistaConfirmar() : vistaAcceso();
  }

  // ───────────────────────────── Acciones
  async function ejecutar(fn) {
    if (st.ocupado) return;
    st.ocupado = true; aviso(""); pintarSiVisible();
    try { await fn(); } catch (e) { aviso(traducirError(e)); }
    st.ocupado = false; pintarSiVisible();
  }

  function urlVuelta() {
    // el enlace del correo vuelve a esta misma página (si es http/https); si no, Supabase usa la Site URL
    return /^https?:$/.test(location.protocol) ? location.origin + location.pathname : undefined;
  }

  async function registrar(correo, clave, clave2) {
    const err = validarCorreo(correo) || validarClave(clave, clave2, true);
    if (err) { aviso(err); return; }
    const { data, error } = await sb.auth.signUp({ email: correo, password: clave, options: { emailRedirectTo: urlVuelta() } });
    if (error) { error.contexto = "registro"; throw error; }
    if (data.session) return; // confirmación desactivada: ya hay sesión (onAuthStateChange pinta el perfil)
    st.enviado = correo;
  }

  async function entrar(correo, clave) {
    const err = validarCorreo(correo) || (clave ? "" : "Escribe tu contraseña.");
    if (err) { aviso(err); return; }
    const { error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
    if (error) throw error;
  }

  async function guardarNombre(nombre) {
    nombre = String(nombre || "").trim();
    const err = validarNombre(nombre);
    if (err) { aviso(err); return; }
    if (nombre === st.perfil.username) { aviso("Ese ya es tu nombre de agente.", "ok"); return; }
    const { error } = await sb.from("profiles").update({ username: nombre }).eq("id", st.sesion.user.id);
    if (error) throw error;
    await cargarPerfil();
    aviso("Nombre guardado.", "ok");
  }

  document.addEventListener("submit", e => {
    const f = e.target.closest && e.target.closest("#s-cuenta [data-ol-form]");
    if (!f) return;
    e.preventDefault();
    const v = id => (document.getElementById(id) || {}).value || "";
    const tipo = f.dataset.olForm;
    // Leer los campos AHORA: ejecutar() vuelve a pintar el formulario (botón «Un momento…») y eso vacía los inputs.
    const correo = v("ol-correo").trim(), clave = v("ol-clave"), clave2 = v("ol-clave2"), nombre = v("ol-nombre");
    if (tipo !== "nombre") st.correo = correo;
    if (tipo === "registro") ejecutar(() => registrar(correo, clave, clave2));
    else if (tipo === "entrar") ejecutar(() => entrar(correo, clave));
    else if (tipo === "nombre") ejecutar(() => guardarNombre(nombre));
  });

  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("#s-cuenta [data-ol]");
    if (!b || b.disabled) return;
    const que = b.dataset.ol;
    if (que === "modo") {
      const c = document.getElementById("ol-correo"); if (c) st.correo = c.value.trim();
      st.modo = b.dataset.id; st.enviado = ""; aviso(""); pintarSiVisible();
    } else if (que === "reenviar") {
      ejecutar(async () => {
        const { error } = await sb.auth.resend({ type: "signup", email: st.enviado, options: { emailRedirectTo: urlVuelta() } });
        if (error) throw error;
        aviso("Correo reenviado.", "ok");
      });
    } else if (que === "salir") {
      ejecutar(async () => { const { error } = await sb.auth.signOut(); if (error) throw error; st.modo = "entrar"; });
    } else if (que === "recargar") {
      ejecutar(cargarPerfil);
    }
  });

  window.CuentaOnline = {
    pintar,
    cliente: sb,                       // para las fases siguientes (amigos, partidas)
    sesion: () => st.sesion,
    perfil: () => st.perfil,
    util,
    // espera a que supabase-js lea la sesión guardada (o la del enlace de confirmación) antes del primer pintado
    listo: sb.auth.getSession().then(({ data }) => { st.sesion = data.session; return st.sesion ? cargarPerfil().catch(e => aviso(traducirError(e))) : null; }),
  };
})();
