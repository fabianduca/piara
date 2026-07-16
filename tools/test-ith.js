/* Piara — tests rapidos del motor ITH (sin framework, solo assertions). */
const path = require("path");
const ITH = require(path.join("..", "src", "shared", "ith"));

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.error("  ✗", name); } }
function approx(a, b, tol = 0.5) { return Math.abs(a - b) <= tol; }

console.log("Motor ITH — casos:");

// 20C / 50% -> confort claro (ITH < 74)
const a = ITH.computeITH(20, 50);
check(`ITH(20C,50%)=${a} es confort (<74)`, a < 74 && ITH.severityFromITH(a).level === 0);

// 28C humedad baja (14%) vs alta (90%): la alta debe dar mas estres.
const seco = ITH.computeITH(28, 14);
const humedo = ITH.computeITH(28, 90);
check(`ITH 28C humedo(${humedo}) > seco(${seco})`, humedo > seco);
check(`28C/90% cae en alerta o peor`, ITH.severityFromITH(humedo).level >= 1);

// 35C / 80% -> emergencia (>=84)
const ext = ITH.computeITH(35, 80);
check(`ITH(35C,80%)=${ext} es peligro/emergencia`, ITH.severityFromITH(ext).level >= 2);

// Ajuste por categoria: cerda (offset +4) siente mas que lechon en calor.
const cerda = ITH.ithForCategory(30, 70, "cerda");
const lechon = ITH.ithForCategory(30, 70, "lechon");
check(`Cerda(${cerda}) percibe mas calor que lechon(${lechon})`, cerda > lechon);

// Frio en lechon: evaluateShed debe marcar flag "cold".
const evalFrio = ITH.evaluateShed({ id: 1, category: "lechon", name: "Mat" }, { temp: 22, humidity: 60 });
check("Lechon a 22C dispara flag de frio", evalFrio.flags.some((f) => f.type === "cold"));

// Alertas de lluvia: 40mm en 24h -> alerta rain severidad >=2.
const forecast = Array.from({ length: 24 }, (_, i) => ({ ts: new Date(Date.now() + i * 3.6e6).toISOString(), temp: 18, humidity: 60, rainMm: 40 / 24 }));
const alerts = ITH.buildAlerts([{ id: 1, name: "G", category: "engorde" }], forecast);
check("40mm/24h genera alerta de lluvia", alerts.some((x) => x.type === "rain" && x.severity >= 2));

// Suelo saturado agrava la alerta de lluvia (sube severidad).
const wet = Array.from({ length: 24 }, () => ({ ts: new Date().toISOString(), temp: 16, humidity: 80, rainMm: 1, soil: 0.42 }));
const soilAlerts = ITH.buildAlerts([{ id: 1, name: "G", category: "engorde" }], wet);
check("Suelo saturado (0.42) genera alerta de anegamiento", soilAlerts.some((x) => x.type === "rain"));
check("soilRisk marca nivel Saturado con 0.42", ITH.soilRisk(wet).level === 3);
check("soilRisk normal con suelo seco (0.15)", ITH.soilRisk([{ soil: 0.15 }]).level === 0);

// Economia: ola de calor genera perdida > 0.
const hot = Array.from({ length: 24 }, () => ({ temp: 34, humidity: 75, rainMm: 0 }));
const econ = ITH.economicImpact([{ id: 1, name: "Eng", category: "engorde", animals: 900 }], hot, {});
check(`Ola de calor => perdida evitable USD ${econ.usdDia} > 0`, econ.usdDia > 0);

// ---- Motor de produccion ----
const PROD = require(path.join("..", "src", "shared", "production"));
console.log("\nMotor de producción — casos:");

// Lote de engorde: 60 dias, buena pesada.
const batchOK = {
  start_date: "2026-05-01", animals_in: 900, weight_in_kg: 25, target_weight_kg: 110,
  feed_kg: 130000, deaths: 20, current_weight_kg: 82, current_weight_date: "2026-06-30", status: "active",
};
const mOK = PROD.batchMetrics(batchOK, {}, "2026-06-30T12:00:00");
check(`ADG calculado ${mOK.adg} kg/d ~ (82-25)/60`, approx(mOK.adg, 0.95, 0.05));
check(`IC/FCR calculado ${mOK.fcr}`, mOK.fcr > 2 && mOK.fcr < 4);
check(`Mortandad ${mOK.mortalityPct}% ~ 20/900`, approx(mOK.mortalityPct, 2.2, 0.2));
check(`Proyeccion de faena en ${mOK.projDays} dias (>0)`, mOK.projDays > 0);

// Lote con ADG bajo -> alerta de rendimiento.
const batchBad = { ...batchOK, current_weight_kg: 55 }; // gano poco
const mBad = PROD.batchMetrics(batchBad, {}, "2026-06-30T12:00:00");
const aBad = PROD.batchAlerts(batchBad, mBad);
check(`ADG bajo (${mBad.adg}) dispara alerta y pérdida > 0`, aBad.some((a) => a.kpi === "ADG") && mBad.lossUsdTotal > 0);

// Rollup de lotes.
const roll = PROD.rollup([{ batch: batchOK, metrics: mOK }, { batch: batchBad, metrics: mBad }]);
check(`Rollup suma ${roll.lotes} lotes activos`, roll.lotes === 2 && roll.animals > 0);

// ---- Motor reproductivo ----
const REPRO = require(path.join("..", "src", "shared", "repro"));
console.log("\nMotor reproductivo — casos:");
// Servicio el 2026-04-01 -> parto esperado ~2026-07-24 (114 dias).
const mat = { sow_label: "214", service_date: "2026-04-01", status: "gestando" };
const rm = REPRO.metrics(mat, "2026-07-21");
check(`Parto esperado ${rm.expectedFarrow} (114d desde 01/04)`, rm.expectedFarrow === "2026-07-24");
check(`Faltan ${rm.daysToFarrow} días para parir (~3)`, approx(rm.daysToFarrow, 3, 1));
const ra = REPRO.alerts(mat, rm);
check("Parto inminente (<=3d) dispara alerta nivel 2", ra.some((a) => a.level === 2 && a.kind === "parto-inminente"));
// Rollup cuenta gestando y partos proximos.
const rroll = REPRO.rollup([{ m: mat, mt: rm }], "2026-07-21");
check(`Rollup: ${rroll.gestando} gestando, ${rroll.partosNext7} en 7d`, rroll.gestando === 1 && rroll.partosNext7 === 1);

// ---- Motor de agua ----
const WATER = require(path.join("..", "src", "shared", "water"));
console.log("\nMotor de agua — casos:");
const wr = [
  { day: "2026-07-01", liters: 7200 }, { day: "2026-07-02", liters: 7100 },
  { day: "2026-07-03", liters: 7300 }, { day: "2026-07-04", liters: 4800 }, // caida
];
const wa = WATER.analyze(wr, "engorde", 900);
check(`Caída de agua detectada (-${wa.dropPct}%) nivel ${wa.level}`, wa.dropPct >= 30 && wa.level === 2);
const wOk = WATER.analyze([{ day: "2026-07-01", liters: 7200 }, { day: "2026-07-02", liters: 7100 }], "engorde", 900);
check("Consumo estable => nivel 0", wOk.level === 0);
check("Esperado ~ 8L x 900 = 7200", WATER.expectedFor("engorde", 900) === 7200);

// ---- Motor sanitario ----
const HEALTH = require(path.join("..", "src", "shared", "health"));
console.log("\nMotor sanitario — casos:");
const evVenc = { title: "Parvovirus", next_due: "2026-07-01", done: 0 };
const stVenc = HEALTH.eventStatus(evVenc, "2026-07-08");
check(`Evento vencido (nivel ${stVenc.level})`, stVenc.state === "vencido" && stVenc.level === 2);
const evProx = { title: "Refuerzo", next_due: "2026-07-12", done: 0 };
const stProx = HEALTH.eventStatus(evProx, "2026-07-08");
check(`Evento próximo en ${stProx.daysToDue}d (nivel 1)`, stProx.state === "proximo" && stProx.level === 1);
const evOk = { title: "X", next_due: "2026-08-30", done: 0 };
check("Evento lejano => al-dia nivel 0", HEALTH.eventStatus(evOk, "2026-07-08").level === 0);
const hRoll = HEALTH.rollup([{ st: stVenc }, { st: stProx }, { st: HEALTH.eventStatus(evOk, "2026-07-08") }]);
check(`Rollup: ${hRoll.vencidos} venc, ${hRoll.proximos} prox`, hRoll.vencidos === 1 && hRoll.proximos === 1);
check("Hay plan sugerido para cerda", Array.isArray(HEALTH.SUGGESTED.cerda) && HEALTH.SUGGESTED.cerda.length > 0);

console.log(`\n${pass} OK, ${fail} fallidos.`);
process.exit(fail ? 1 : 0);
