// Servidor falso en memoria con las mismas reglas que las funciones SQL de la partida online
// (supabase/migrations/20261124100000_v2_online_base.sql y 20261125120000_resultado_segundos_restantes.sql).
// Cada jugador recibe un cliente con la forma de supabase-js que usa online/partida.js:
//   rpc(nombre, args) · from(tabla).select().eq().gt().in().order() · channel().on().subscribe() · removeChannel()
// Las jugadas nuevas llegan a los suscritos por «Realtime» con un retraso virtual.
const { mulberry } = require("../motor-semilla/simulador.cjs");

function crearServidor({ reloj, banco, jugadores, turnos, semilla, semillaServidor = 99, latencia = 40, EPOCA = Date.parse("2026-11-26T10:00:00Z"), conInactividad = true }) {
  const rnd = mulberry(semillaServidor);
  const ahora = () => EPOCA + reloj.ahora;
  const S = {
    status: "in_progress", current: null, log: [], qs: {}, usadas: new Set(), latido: {}, fuera: new Set(),
    informes: {}, ganador: null, motivo: null, subs: [], llamadas: [], bcast: [], enviados: [],
  };
  S.actividad = {}; S.pendiente = {}; S.marcas = []; S.empezada = ahora();
  jugadores.forEach(u => { S.latido[u] = ahora(); S.actividad[u] = ahora(); });
  const err = (message, code = "P0001") => ({ data: null, error: { code, message } });
  const ok = data => ({ data, error: null });

  function anotar(user, kind, payload) {
    const a = { seq: S.log.length, user_id: user, kind, payload, created_at: new Date(ahora()).toISOString() };
    S.log.push(a);
    S.subs.forEach(fn => reloj.setTimeout(() => fn({ new: { ...a, payload: JSON.parse(JSON.stringify(payload)) } }), latencia));
    return a.seq;
  }
  function cerrar(i, result, option) {
    const q = S.qs[i]; if (!q || q.closed) return;
    q.closed = true; q.result = result;
    const seg = result === "timeout" ? 0 : Math.max(0, Math.floor((q.cierra - ahora()) / 100) / 10);
    anotar(null, "resultado", { question_index: i, player: q.player, result, option: option ?? null, segundos_restantes: seg });
  }
  function avanzar() {
    if (S.status === "in_progress" && S.current != null) { const q = S.qs[S.current]; if (q && !q.closed && q.cierra <= ahora()) cerrar(S.current, "timeout", null); }
  }
  function terminar(w, motivo) {
    if (S.status === "finished") return;
    if (S.current != null) cerrar(S.current, "timeout", null);
    S.status = "finished"; S.ganador = w; S.motivo = motivo;
    anotar(null, "fin", { winner: w, reason: motivo });
  }
  function abandono(u) {
    if (S.status !== "in_progress" || S.fuera.has(u)) return;
    S.fuera.add(u);
    if (S.current != null && S.qs[S.current].player === u && !S.qs[S.current].closed) cerrar(S.current, "timeout", null);
    anotar(null, "abandono", { player: u });
    const quedan = jugadores.filter(j => !S.fuera.has(j));
    if (quedan.length <= 1) terminar(quedan[0] || null, "forfeit");
  }
  const activo = u => {
    if (!jugadores.includes(u)) return "No estás en esa partida";
    if (S.status !== "in_progress") return "La partida no está en curso";
    if (S.fuera.has(u)) return "Abandonaste esta partida";
    return null;
  };

  const RPC = {
    submit_action(u, a) {
      const e = activo(u); if (e) return err(e);
      if (["inicio", "pregunta", "resultado", "comodin", "abandono", "fin"].includes(a.p_kind)) return err("Esa jugada la anota el servidor");
      if (a.p_expected_seq !== S.log.length) return err("Desincronizado: la siguiente jugada es la " + S.log.length, "40001");
      avanzar();
      return ok(anotar(u, a.p_kind, a.p_payload));
    },
    draw_question(u, a) {
      const e = activo(u); if (e) return err(e);
      if (a.p_nivel < 1 || a.p_nivel > 7) return err("Nivel no válido");
      if (a.p_segundos < 5 || a.p_segundos > 60) return err("Segundos no válidos");
      avanzar();
      if (S.current != null && !S.qs[S.current].closed) return err("Todavía hay una pregunta abierta");
      const bloques = [...new Set(banco.map(q => q.b))];
      const bloque = a.p_bloque || bloques[Math.floor(rnd() * bloques.length)];
      const libres = banco.map((q, k) => ({ q, k })).filter(x => !S.usadas.has(x.k));
      let cand = libres.filter(x => x.q.n === a.p_nivel && x.q.b === bloque);
      if (!cand.length) cand = libres.slice().sort((x, y) => ((y.q.n === a.p_nivel) - (x.q.n === a.p_nivel)) || ((y.q.b === bloque) - (x.q.b === bloque)));
      if (!cand.length) return err("No quedan preguntas disponibles");
      const el = cand[Math.floor(rnd() * Math.min(cand.length, cand.length))];
      S.usadas.add(el.k);
      const i = S.current == null ? 0 : S.current + 1;
      S.qs[i] = { repartida: ahora(), k: el.k, q: el.q, player: u, tipo: a.p_tipo, segundos: a.p_segundos, abierta: false, cierra: ahora() + 10000, closed: false, descartadas: [], comodines: [] };
      S.current = i;
      anotar(u, "pregunta", { question_index: i, tipo: a.p_tipo, bloque: el.q.b, nivel: el.q.n, nivel_pedido: a.p_nivel, segundos: a.p_segundos });
      return ok(i);
    },
    get_current_question(u) {
      if (!jugadores.includes(u)) return err("No estás en esa partida");
      avanzar();
      if (S.current == null) return ok([]);
      const q = S.qs[S.current];
      if (q.player === u && !q.abierta && !q.closed && S.status === "in_progress") { q.abierta = true; q.cierra = ahora() + q.segundos * 1000; }
      return ok([{ question_index: S.current, player_id: q.player, tipo: q.tipo, bloque: q.q.b, nivel: q.q.n, texto: q.q.q, opciones: q.q.o,
        descartadas: q.descartadas.slice(), opened: q.abierta, closes_at: new Date(q.cierra).toISOString(), closed: q.closed }]);
    },
    use_lifeline(u, a) {
      const e = activo(u); if (e) return err(e);
      avanzar();
      const q = S.qs[a.p_index];
      if (!q || q.player !== u || q.closed || !q.abierta) return err("No tienes esa pregunta abierta");
      if (q.comodines.includes(a.p_kind)) return err("Ese comodín ya se usó en esta pregunta");
      let fuera = [];
      if (a.p_kind === "mitad") {
        const falsas = q.q.o.map((_, k) => k).filter(k => k !== q.q.a);
        while (falsas.length > 1 && fuera.length < q.q.o.length - 2) fuera.push(falsas.splice(Math.floor(rnd() * falsas.length), 1)[0]);
        q.descartadas = fuera;
      } else if (a.p_kind === "tiempo") q.cierra += 10000;
      else return err("Comodín no válido");
      q.comodines.push(a.p_kind);
      anotar(u, "comodin", { question_index: a.p_index, kind: a.p_kind, descartadas: fuera });
      return ok(fuera);
    },
    submit_answer(u, a) {
      if (S.qs[a.p_index] && S.qs[a.p_index].player !== u) S.respuestasAjenas = (S.respuestasAjenas || 0) + 1;   // intento de responder la pregunta del otro
      const e = activo(u); if (e) return err(e);
      avanzar();
      const q = S.qs[a.p_index];
      if (a.p_index !== S.current) return err("Esa no es la pregunta en juego");
      if (q.player !== u) return err("Esta pregunta no es tuya");
      if (q.closed || q.cierra <= ahora()) return err("La pregunta ya está cerrada");
      if (q.descartadas.includes(a.p_option)) return err("Esa opción está descartada");
      if (a.p_option >= q.q.o.length) return err("Opción no válida");
      const bien = a.p_option === q.q.a;
      cerrar(a.p_index, bien ? "correct" : "wrong", a.p_option);
      return ok([{ correct: bien, respuesta_correcta: q.q.a, explicacion: q.q.d || "" }]);
    },
    get_question_result(u, a) {
      if (!jugadores.includes(u)) return err("No estás en esa partida");
      avanzar();
      const q = S.qs[a.p_index];
      if (!q || !q.closed) return ok([]);
      return ok([{ question_index: a.p_index, player_id: q.player, result: q.result, respuesta_correcta: q.q.a, explicacion: q.q.d || "" }]);
    },
    // migración 20261126120000_inactividad.sql (si conInactividad es false, el servidor se comporta como sin aplicarla)
    // versión A: p_pendiente (true fija pendiente_desde si estaba vacío, false lo limpia, null no lo toca) y
    // p_actividad (por defecto true; false = latido con algo pendiente, que no renueva la actividad)
    mark_activity(u, a) {
      if (!conInactividad) return err("Could not find the function public.mark_activity(p_match) in the schema cache", "PGRST202");
      if (!jugadores.includes(u)) return err("No estás en esa partida");
      S.marcas.push({ u, t: ahora(), p_pendiente: a.p_pendiente, p_actividad: a.p_actividad });
      if (!S.fuera.has(u)) {
        S.latido[u] = ahora();
        if (a.p_actividad !== false) S.actividad[u] = ahora();
        if (a.p_pendiente === true) S.pendiente[u] = S.pendiente[u] ?? ahora();
        else if (a.p_pendiente === false) S.pendiente[u] = null;
      }
      avanzar(); return ok(null);
    },
    claim_inactivity(u, a) {
      if (!conInactividad) return err("Could not find the function public.claim_inactivity(p_match, p_user) in the schema cache", "PGRST202");
      const e = activo(u); if (e) return err(e);
      if (a.p_user === u) return err("Para abandonar usa leave_match");
      avanzar();
      if (S.fuera.has(a.p_user) || !jugadores.includes(a.p_user)) return err("Ese jugador no sigue en la partida");
      const act = Math.max(S.actividad[a.p_user], S.empezada);
      const q = S.current != null ? S.qs[S.current] : null;
      const preg = q && q.player === a.p_user && !q.closed && q.cierra > ahora() ? q.repartida : null;
      const pend = S.pendiente[a.p_user] ?? preg;
      if (pend != null) { if (Math.max(act, pend) > ahora() - 60000) return err("Ese jugador sigue activo"); }
      else if (act > ahora() - 180000) return err("Ese jugador no tiene ninguna acción pendiente");
      abandono(a.p_user); return ok(null);
    },
    heartbeat(u) {
      if (!jugadores.includes(u)) return err("No estás en esa partida");
      if (!S.fuera.has(u)) S.latido[u] = ahora();
      avanzar(); return ok(null);
    },
    claim_forfeit(u, a) {
      const e = activo(u); if (e) return err(e);
      if (a.p_user === u) return err("Para abandonar usa leave_match");
      if (S.fuera.has(a.p_user)) return err("Ese jugador no sigue en la partida");
      if (S.latido[a.p_user] > ahora() - 60000) return err("Ese jugador sigue conectado");
      abandono(a.p_user); return ok(null);
    },
    leave_match(u) {
      if (!jugadores.includes(u)) return err("No estás en esa partida");
      if (S.status === "in_progress") abandono(u);
      return ok(null);
    },
    report_result(u, a) {
      const e = activo(u); if (e) return err(e);
      S.informes[u] = JSON.stringify(Object.keys(a.p_scores).sort().map(k => [k, a.p_scores[k]]));
      const siguen = jugadores.filter(j => !S.fuera.has(j));
      if (siguen.some(j => !S.informes[j])) return ok(null);
      if (new Set(siguen.map(j => S.informes[j])).size > 1) { terminar(null, "disputed"); return ok(null); }
      const max = Math.max(...siguen.map(j => a.p_scores[j]));
      const g = siguen.filter(j => a.p_scores[j] === max);
      terminar(g.length === 1 ? g[0] : null, "completed");
      return ok(null);
    },
  };

  function cliente(u) {
    return {
      async rpc(nombre, args) {
        S.llamadas.push(u.slice(-1) + ":" + nombre);
        if (!RPC[nombre]) return err("RPC desconocida " + nombre);
        return RPC[nombre](u, args || {});
      },
      from(tabla) {
        const f = {};
        const q = {
          select() { return q; }, order() { return q; },
          eq(c, v) { f[c] = v; return q; }, gt(c, v) { f["gt_" + c] = v; return q; }, in(c, v) { f["in_" + c] = v; return q; },
          then(res, rej) {
            let d = [];
            if (tabla === "match_actions") d = S.log.filter(a => a.seq > (f.gt_seq ?? -1)).map(a => ({ ...a, payload: JSON.parse(JSON.stringify(a.payload)) }));
            if (tabla === "match_players") d = jugadores.map((id, seat) => Object.assign({ user_id: id, seat, forfeited: S.fuera.has(id), last_heartbeat: new Date(S.latido[id]).toISOString() },
              conInactividad ? { ultima_actividad_at: new Date(S.actividad[id]).toISOString(), pendiente_desde: S.pendiente[id] != null ? new Date(S.pendiente[id]).toISOString() : null } : {}));
            if (tabla === "profiles") d = (f.in_id || []).map(id => ({ id, username: "agente_" + id.slice(-4) }));
            return Promise.resolve({ data: d, error: null }).then(res, rej);
          },
        };
        return q;
      },
      // canal de Realtime: postgres_changes (jugadas nuevas) y broadcast (avisos efímeros entre clientes, sin eco)
      channel() {
        const ch = {
          on(ev, filtro, fn) { if (ev === "broadcast") S.bcast.push({ u, ch, evento: filtro.event, fn }); else S.subs.push(fn); return ch; },
          subscribe() { return ch; },
          send(m) {
            S.bcast.filter(b => b.u !== u && b.evento === m.event && !b.cerrado)
              .forEach(b => reloj.setTimeout(() => { if (!b.cerrado) b.fn({ payload: JSON.parse(JSON.stringify(m.payload)) }); }, latencia));
            S.enviados.push(u.slice(-1) + ":" + m.event + ":" + (m.payload && m.payload.tipo));
            return Promise.resolve("ok");
          },
        };
        return ch;
      },
      removeChannel(ch) { S.bcast.forEach(b => { if (b.ch === ch) b.cerrado = true; }); },
    };
  }

  anotar(null, "inicio", { seed: semilla, mode: "points", turns: turnos, players: jugadores.slice() });
  return { S, cliente, RPC, ahora };
}
module.exports = { crearServidor };
