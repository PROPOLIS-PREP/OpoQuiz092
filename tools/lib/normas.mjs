// Normas de los bloques ordenanzas, social y tráfico para tools/citar-ley.mjs.
// La fuente de estas preguntas suele ser "Art. 27 Ordenanza del Taxi" o "Art. 5 LPRL (Ley 31/1995)",
// así que la norma se busca en cualquier punto de la fuente (la que aparezca antes) y no solo al principio.
//   art: artículo con que se nombra · nom: cómo se nombra en el enunciado · f: cómo aparece en la fuente y en las opciones
export const NORMAS = [
  // ordenanzas
  { art: "la", nom: "Ordenanza de Movilidad Sostenible", f: /Ordenanza de Movilidad Sostenible/ },
  { art: "la", nom: "Ordenanza del Taxi", f: /Ordenanza del Taxi/ },
  { art: "la", nom: "Ordenanza 12/2022 de Limpieza de los Espacios Públicos", f: /Ordenanza 12\/2022/ },
  { art: "la", nom: "Ordenanza de Protección contra la Contaminación Acústica y Térmica", f: /Ordenanza de Contaminaci[oó]n Ac[uú]stica/ },
  { art: "la", nom: "Ordenanza de Salubridad Pública", f: /Ordenanza de Salubridad/ },
  { art: "la", nom: "Ordenanza de Venta Ambulante", f: /Ordenanza de Venta Ambulante/ },
  { art: "la", nom: "OPMAU (Ordenanza General de Protección del Medio Ambiente Urbano)", f: /\bOPMAU\b/ },
  { art: "la", nom: "LEPAR (Ley 17/1997, de Espectáculos Públicos y Actividades Recreativas)", f: /\bLEPAR\b|Ley 17\/1997/ },
  { art: "el", nom: "Catálogo de la LEPAR (Decreto 184/1998)", f: /Decreto 184\/1998/ },
  { art: "la", nom: "Orden de 21 de abril de 2022, de horarios de los locales", f: /Orden de 21-04-2022/ },
  // social
  { art: "la", nom: "LOEx (LO 4/2000, de extranjería)", f: /\bLOEx\b|LO 4\/2000/ },
  { art: "la", nom: "Ley 5/2002, de Drogodependencias y otros Trastornos Adictivos de la CM", f: /Ley 5\/2002/ },
  { art: "la", nom: "LO 1/2004, de Medidas de Protección Integral contra la Violencia de Género", f: /LO 1\/2004/ },
  { art: "la", nom: "LO 3/2007, para la igualdad efectiva de mujeres y hombres", f: /LO 3\/2007/ },
  { art: "la", nom: "Ley 4/2023, para la igualdad real y efectiva de las personas trans y LGTBI", f: /Ley 4\/2023/ },
  { art: "la", nom: "LPRL (Ley 31/1995, de Prevención de Riesgos Laborales)", f: /\bLPRL\b|Ley 31\/1995/ },
  { art: "la", nom: "Ley 27/2003, de la orden de protección", f: /Ley 27\/2003/ },
  { art: "el", nom: "Acuerdo-Convenio del Ayuntamiento de Madrid 2019-2022", f: /Acuerdo-Convenio/ },
  { art: "el", nom: "III Plan de Igualdad del Ayuntamiento de Madrid", f: /III Plan de Igualdad/ },
  { art: "el", nom: "Protocolo del Sistema VioGén", f: /Sistema VioG[eé]n/ },
  { art: "el", nom: "Estatuto de los Trabajadores", f: /\bET\b/ },
  // tráfico
  { art: "la", nom: "Ley de Tráfico y Seguridad Vial (RDLeg 6/2015)", f: /\bLSV\b|\bLTSV\b|RDL 6\/2015/ },
  { art: "el", nom: "Reglamento General de Circulación (RD 1428/2003)", f: /\bRGCir\b|RD 1428\/2003/ },
  { art: "el", nom: "Reglamento General de Conductores (RD 818/2009)", f: /\bRGCon\b|RD 818\/2009/ },
  { art: "el", nom: "Reglamento General de Vehículos (RD 2822/1998)", f: /\bRGV\b|RD 2822\/1998/ },
  { art: "el", nom: "Reglamento del Seguro Obligatorio de Automóviles (RD 1507/2008)", f: /\bRSOA\b|RD 1507\/2008/ },
  { art: "el", nom: "Reglamento de procedimiento sancionador en materia de tráfico (RD 320/1994)", f: /RD 320\/1994/ },
  { art: "la", nom: "Ley sobre responsabilidad civil y seguro en la circulación de vehículos a motor (RDLeg 8/2004)", f: /RDL 8\/2004/ },
  { art: "la", nom: "Ley 22/2006, de Capitalidad y Régimen Especial de Madrid", f: /Ley 22\/2006/ },
  { art: "la", nom: "LJCA (Ley 29/1998)", f: /\bLJCA\b/ },
  { art: "la", nom: "LPAC (Ley 39/2015)", f: /\bLPAC\b/ },
  // comunes
  { art: "la", nom: "Constitución", f: /\bCE\b/ },
  { art: "el", nom: "Código Penal", f: /\bCP\b/ },
  { art: "la", nom: "Ley de Enjuiciamiento Criminal", f: /\bLECrim\b/ },
  { art: "la", nom: "LOFCS (LO 2/1986)", f: /\bLOFCS\b/ },
  { art: "el", nom: "Reglamento de Armas (RD 137/1993)", f: /RD 137\/1993/ },
  { art: "la", nom: "Ley 1/2018, de Coordinación de Policías Locales de la CM", f: /Ley 1\/2018/ },
];

export const BLOQUES_NORMAS = new Set(["ordenanzas", "social", "trafico"]);

// Norma citada solo por su número ("RD 920/2017", "Orden INT/2223/2014"): se nombra tal cual.
const NUMERICA = /(Orden INT\/\d+\/\d{4}|RDL \d+\/\d{4}|RD \d+\/\d{4}|Ley \d+\/\d{4}|Decreto \d+\/\d{4})/;
function normaNumerica(texto) {
  const m = texto.match(NUMERICA);
  if (!m) return null;
  const nom = m[1];
  return { art: /^(Orden|Ley)/.test(nom) ? "la" : "el", nom, f: new RegExp(nom.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")) };
}

// La norma de una fuente: la primera parte (separadas por «;») que nombre alguna, y dentro de ella la que aparezca antes.
export function normaDeFuente(fuente) {
  for (const seg of fuente.split(";").map(s => s.trim()).filter(Boolean)) {
    let mejor = null, pos = Infinity;
    for (const n of NORMAS) { const m = seg.match(n.f); if (m && m.index < pos) { mejor = n; pos = m.index; } }
    if (mejor) return mejor;
    const num = normaNumerica(seg);
    if (num) return num;
  }
  return null;
}

// Tráfico: preguntas de los tests y de los temas cuya fuente es genérica ("Test 2 Bloque Tráfico · Tema 30")
// pero cuya norma está clara por la materia. Las de doctrina (física del accidente, tipos de accidente,
// farmacología del alcohol, terminología de semáforos…) no se asignan: no hay una norma que citar.
const porNombre = parte => NORMAS.find(n => n.nom.includes(parte));
const LSV = porNombre("Ley de Tráfico y Seguridad Vial"), RGCIR = porNombre("Reglamento General de Circulación"),
  RGCON = porNombre("Reglamento General de Conductores"), RGV = porNombre("Reglamento General de Vehículos"),
  CP = porNombre("Código Penal");
const ITV = { art: "el", nom: "RD 920/2017, de inspección técnica de vehículos", f: /RD 920\/2017/ };
const ids = (pref, ...n) => n.map(x => `TRA-${pref}-${String(x).padStart(2, "0")}`);
const rango = (pref, a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i).map(x => `TRA-${pref}-${String(x).padStart(2, "0")}`);
const tema = (...n) => n.map(x => `TRA-T${Math.floor(x / 1000)}-${String(x % 1000).padStart(3, "0")}`);
const ASIGNADAS = new Map();
const asignar = (norma, lista) => lista.forEach(id => ASIGNADAS.set(id, norma));
asignar(LSV, [...rango("TEST1", 3, 10), ...rango("TEST1", 15, 20), ...ids("TEST1", 25, 35, 38, 40, 43, 44),
  ...ids("TEST2", 4, 10, 11, 12, 16, 17, 18, 19, 37, 42, 43, 44, 45, 46, 47), ...rango("TEST3", 1, 5), ...rango("TEST3", 9, 12),
  ...rango("TEST3", 15, 25), ...ids("TEST3", 33, 37, 45, 48, 49, 50), ...tema(28002, 28003, 30001, 30002, 30003, 30032)]);
asignar(RGCON, ids("TEST2", 7, 8, 9, 49));
asignar(ITV, [...ids("TEST1", 11, 12), ...ids("TEST2", 14, 50)]);
asignar(RGV, [...ids("TEST1", 13, 14), ...ids("TEST2", 13)]);
asignar(RGCIR, [...ids("TEST1", 21, 22, 24, 32, 33, 48, 49), ...ids("TEST2", 21, 22, 23, 24, 32), ...ids("TEST3", 27, 28, 29),
  ...tema(29011, 29012, 29013, 29057, 29058, 29059, 29060, 29061, 29062, 29063)]);
asignar(CP, ids("TEST1", 39).concat(ids("TEST3", 36)));
export const normaDeId = id => ASIGNADAS.get(id) || null;
