// Simulador sin navegador: ejecuta el <script> de un index.html en un contexto vm con un DOM falso,
// temporizadores virtuales instantáneos y Math.random controlado, y juega una partida local solo con bots.
//
//   const r = simular(rutaHtml, { semillaRandom, semillaJuego, rondas, jugadores })
//   r = { traza: [...decisiones], llamadas: [...quién pidió azar], final: {...}, atascos, pasos }
const fs = require("fs"), vm = require("vm");

function mulberry(seed) {
  let h = seed >>> 0;
  return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, 1 | h); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ── DOM falso permisivo
function crearDOM() {
  const porId = new Map(), porSel = new Map();
  const noop = () => {};
  function Elemento(tag = "div", id = "") {
    const clases = new Set();
    const base = {
      tagName: tag.toUpperCase(), id, children: [], parentNode: null, dataset: {}, style: new Proxy({ setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] ?? ""; } }, { get: (t, k) => t[k] ?? "", set: (t, k, v) => { t[k] = v; return true; } }),
      _texto: "", _html: "", value: "", disabled: false, onclick: null, hidden: false, checked: false,
      offsetWidth: 100, offsetHeight: 100, clientWidth: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0,
      classList: { add: (...c) => c.forEach(x => clases.add(x)), remove: (...c) => c.forEach(x => clases.delete(x)), toggle: (c, f) => { const on = f === undefined ? !clases.has(c) : !!f; on ? clases.add(c) : clases.delete(c); return on; }, contains: c => clases.has(c) },
      get className() { return [...clases].join(" "); }, set className(v) { clases.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => clases.add(c)); },
      get textContent() { return this._texto; }, set textContent(v) { this._texto = String(v); this.children = []; },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.children = []; },
      get firstElementChild() { if (!this._primero) this._primero = Elemento(); return this.children[0] || this._primero; },
      get lastElementChild() { return this.children[this.children.length - 1] || null; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, append(...cs) { cs.forEach(c => typeof c === "object" && this.appendChild(c)); },
      prepend(c) { if (typeof c === "object") this.children.unshift(c); }, insertBefore(c) { return this.appendChild(c); },
      removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      replaceChildren() { this.children = []; }, insertAdjacentHTML: noop, insertAdjacentElement(_, c) { return c; },
      addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, focus: noop, blur: noop, click() { if (this.onclick) this.onclick({}); },
      scrollIntoView: noop, scrollTo: noop, setPointerCapture: noop, releasePointerCapture: noop,
      setAttribute(k, v) { this["_a_" + k] = String(v); }, getAttribute(k) { return this["_a_" + k] ?? null; }, removeAttribute(k) { delete this["_a_" + k]; }, hasAttribute(k) { return ("_a_" + k) in this; },
      getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
      animate: () => ({ onfinish: null, oncancel: null, cancel: noop, finish: noop, finished: Promise.resolve(), play: noop, pause: noop }),
      getAnimations: () => [], closest: () => null, matches: () => false, contains: () => false,
      querySelector: sel => consulta(sel), querySelectorAll: () => [], getElementsByTagName: () => [], getElementsByClassName: () => [],
      cloneNode() { return Elemento(tag); }, getContext: () => new Proxy({}, { get: () => noop }),
    };
    return base;
  }
  function consulta(sel) {
    const m = /^#([\w-]+)$/.exec(sel);
    if (m) return porIdGet(m[1]);
    if (!porSel.has(sel)) porSel.set(sel, Elemento("div"));
    return porSel.get(sel);
  }
  function porIdGet(id) { if (!porId.has(id)) porId.set(id, Elemento("div", id)); return porId.get(id); }
  const body = Elemento("body"), head = Elemento("head"), html = Elemento("html");
  const document = {
    body, head, documentElement: html, readyState: "complete", hidden: false, visibilityState: "visible",
    getElementById: porIdGet, querySelector: consulta, querySelectorAll: () => [], createElement: t => Elemento(t), createElementNS: (_, t) => Elemento(t),
    createTextNode: t => ({ textContent: t }), createDocumentFragment: () => Elemento("fragment"),
    // los oyentes del documento se guardan para poder simular toques y clics (disparar)
    // (primero los de captura; stopImmediatePropagation corta, como en el navegador)
    _oyentes: [], addEventListener(t, fn, op) { this._oyentes.push([t, fn, op === true || !!(op && op.capture)]); },
    removeEventListener(t, fn) { this._oyentes = this._oyentes.filter(o => o[0] !== t || o[1] !== fn); },
    disparar(t, ev) {
      let parado = false;
      ev.stopImmediatePropagation = ev.stopPropagation = () => { parado = true; }; ev.preventDefault = () => {};
      const os = this._oyentes.filter(o => o[0] === t);
      for (const [, fn] of [...os.filter(o => o[2]), ...os.filter(o => !o[2])]) { if (parado) break; fn(ev); }
    },
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
  };
  return { document, porIdGet };
}

// ── temporizadores virtuales
function crearReloj() {
  let ahora = 0, sec = 0; const cola = new Map();
  const programar = (fn, ms, rep) => { const id = ++sec; cola.set(id, { fn, cuando: ahora + Math.max(0, +ms || 0), rep: rep ? Math.max(1, +ms || 1) : 0, orden: id }); return id; };
  return {
    setTimeout: (fn, ms) => programar(fn, ms, false), setInterval: (fn, ms) => programar(fn, ms, true),
    clearTimeout: id => cola.delete(id), clearInterval: id => cola.delete(id),
    paso() {
      if (!cola.size) return false;
      let min = null;
      for (const [id, t] of cola) if (!min || t.cuando < min[1].cuando || (t.cuando === min[1].cuando && t.orden < min[1].orden)) min = [id, t];
      const [id, t] = min; ahora = t.cuando;
      if (t.rep) { t.cuando = ahora + t.rep; t.orden = ++sec; } else cola.delete(id);
      t.fn(); return true;
    },
    // ¿queda algún setTimeout (no intervalo)? Los intervalos (reloj de la pregunta, latido…) no cuentan como trabajo pendiente
    hayTimeouts() { for (const t of cola.values()) if (!t.rep) return true; return false; },
    get pendientes() { return cola.size; }, get ahora() { return ahora; },
  };
}

// Un motor en su propio contexto vm. op.reloj permite compartir el reloj virtual entre varios motores;
// op.ctxExtra añade globales; op.scriptsExtra carga más archivos después del index.html (p. ej. online/partida.js).
function crearEntorno(rutaHtml, op = {}) {
  const html = fs.readFileSync(rutaHtml, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const { document, porIdGet } = crearDOM();
  const reloj = op.reloj || crearReloj();
  const llamadas = [], traza = [];
  const azarBase = mulberry(op.semillaRandom ?? 1);
  const mathFalso = Object.create(Math);
  mathFalso.random = function () {
    const pila = new Error().stack.split("\n");
    // marco 2 = quien llamó a Math.random (o a rngJuego, que en local es el mismo)
    const m = /^\s*at (\S+) \(/.exec(pila[2] || "");
    let quien = m ? m[1] : "anónima";   // sin nombre: «at ruta:línea:col»
    quien = quien.replace(/^(azarJ|azar)$/, "azar").replace(/^(barajarJ|barajar)$/, "barajar");
    llamadas.push(quien);
    // opción para la prueba B: el tiempo que tarda el bot en contestar (un «tiempo», no una decisión) se fija,
    // porque los puntos de un acierto dependen de los segundos que sobran
    if (op.esperaBotFija && quien === "turnoBot") { azarBase(); return 0.5; }
    return azarBase();
  };
  const mem = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Math: mathFalso, document,
    navigator: { language: "es-ES", userAgent: "node" }, location: { protocol: "file:", hash: "", search: "", href: "file:///index.html", pathname: "/index.html", origin: "null" },
    localStorage: { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // como en el navegador: fallan con «Illegal invocation» si se llaman sobre otro objeto (p. ej. obj.setInterval(…))
    setTimeout: comoNavegador(reloj.setTimeout, "setTimeout"), setInterval: comoNavegador(reloj.setInterval, "setInterval"),
    clearTimeout: comoNavegador(reloj.clearTimeout, "clearTimeout"), clearInterval: comoNavegador(reloj.clearInterval, "clearInterval"),
    requestAnimationFrame: fn => reloj.setTimeout(() => fn(reloj.ahora), 16), cancelAnimationFrame: reloj.clearTimeout,
    innerWidth: 400, innerHeight: 800, devicePixelRatio: 1, scrollTo() {}, addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => new Proxy({}, { get: () => "" }), performance: { now: () => reloj.ahora },
    Date, JSON, Object, Array, String, Number, Boolean, Set, Map, WeakMap, Promise, RegExp, Error, TypeError, Symbol, Proxy, Reflect, Intl, URL, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    Image: function () { return {}; }, Audio: function () { return { play: () => Promise.resolve(), pause() {} }; },
  };
  Object.assign(ctx, op.ctxExtra || {});
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  // las funciones de temporizador solo aceptan como «this» la ventana (o nada, en una llamada directa)
  function comoNavegador(fn, nombre) {
    return function () {
      "use strict";
      if (this !== undefined && this !== null && this !== ctx) throw new TypeError(`Failed to execute '${nombre}' on 'Window': Illegal invocation`);
      return fn.apply(null, arguments);
    };
  }
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s, ctx, { filename: rutaHtml });
  for (const f of op.scriptsExtra || []) vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });

  // trazas de decisiones (envolviendo funciones globales y métodos de objetos; no cambian su comportamiento)
  vm.runInContext(`
    globalThis.__traza = [];
    const __og = { lanzarPregunta, responder, finPartida, abrirPanel };
    globalThis.lanzarPregunta = function (p, o = {}) { __traza.push("pregunta j" + p.id + " " + JSON.stringify(o)); return __og.lanzarPregunta.apply(this, arguments); };
    globalThis.responder = function (i) { __traza.push("responde " + i + (preguntaActiva && preguntaActiva.q ? " (" + (preguntaActiva.q.id || preguntaActiva.q.q.slice(0, 30)) + ", correcta " + preguntaActiva.q.a + ")" : "")); return __og.responder.apply(this, arguments); };
    globalThis.finPartida = function () { __traza.push("fin " + JSON.stringify(estado.jugadores.map(j => [j.puntos, j.cat, j.meritos, j.aciertos, j.fallos, j.pos]))); return __og.finPartida.apply(this, arguments); };
    globalThis.abrirPanel = function (pref, o) { if (pref === "carta") __traza.push("carta " + (o.tipo || "") + " · " + o.tit + " · " + (o.txt || "")); return __og.abrirPanel.apply(this, arguments); };
    const __dado = FX.dado; FX.dado = function (n, fin) { __traza.push("dado " + n); return __dado.apply(this, arguments); };
    const __girar = Ruleta.girar; Ruleta.girar = function (b, fin) { __traza.push("ruleta " + b); return __girar.apply(this, arguments); };
  `, ctx);
  return { ctx, reloj, porIdGet, llamadas, traza };
}

function simular(rutaHtml, op = {}) {
  const { ctx, reloj, porIdGet, llamadas, traza } = crearEntorno(rutaHtml, op);

  // partida local, todos bots
  vm.runInContext(`cfg.nJug=${op.jugadores ?? 4}; cfg.rondas=${op.rondas ?? 6}; cfg.modo="puntos";`, ctx);
  const opIni = op.semillaJuego != null ? `{semilla:${JSON.stringify(op.semillaJuego)}}` : "undefined";
  vm.runInContext(`iniciar("rapida"${op.semillaJuego != null ? "," + opIni : ""}); estado.jugadores[0].bot = true;`, ctx);

  let pasos = 0, atascos = 0, clics = 0;
  const btnAccion = porIdGet("btn-accion"), veloCarta = porIdGet("velo-carta"), pieCarta = porIdGet("carta-pie");
  const activa = () => vm.runInContext("estado.activa && pantalla === 'juego'", ctx);
  while (pasos < 200000 && activa()) {
    if (reloj.paso()) { pasos++; continue; }
    // nada pendiente: pulsar lo que pulsaría una persona (botón de la carta abierta o botón de acción)
    const seguir = porIdGet("preg-seguir");
    if (porIdGet("velo-preg").classList.contains("on") && seguir.onclick && /preg-seguir/.test(porIdGet("preg-pie").innerHTML)) {
      traza.push("clic pregunta: Continuar"); porIdGet("preg-pie").innerHTML = ""; seguir.onclick(); clics++; continue;
    }
    const b = veloCarta.classList.contains("on") && pieCarta.children.find(x => !x.disabled && x.onclick);
    if (b) { traza.push("clic carta: " + b.textContent); b.onclick(); clics++; continue; }
    if (!btnAccion.disabled && btnAccion.onclick) { traza.push("clic acción: " + btnAccion.textContent); btnAccion.onclick(); clics++; continue; }
    atascos++; break;
  }
  const t = vm.runInContext("__traza", ctx);
  const final = vm.runInContext("({ronda: estado.ronda, fase: estado.fase, activa: estado.activa, pantalla, usadas: estado.usadas.slice(), jugadores: estado.jugadores.map(j => ({p: j.puntos, cat: j.cat, m: j.meritos, a: j.aciertos, f: j.fallos, pos: j.pos}))})", ctx);
  return { traza: t.concat(traza.length ? [] : []), clics: traza, llamadas, final, atascos, pasos };
}
module.exports = { simular, crearEntorno, crearReloj, mulberry };
