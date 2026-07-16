/* Piara — Motor de produccion / rendimiento porcino.
 * KPIs que definen la rentabilidad de un lote de engorde:
 *  - ADG (ganancia diaria de peso, kg/dia)
 *  - IC / FCR (indice de conversion: kg alimento por kg ganado) -> el numero clave del negocio
 *  - Mortandad (%)
 *  - Proyeccion de faena (dias y fecha al peso objetivo)
 *  - Perdida economica vs objetivo (kg no ganados + alimento desperdiciado)
 *
 * Referencias de industria (engorde): ADG objetivo ~0.85 kg/d; IC bueno ~2.6-2.9;
 * mortandad de engorde deseable <3-4%.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.PiaraProduction = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULTS = {
    adgObjetivo: 0.85,       // kg/dia
    fcrObjetivo: 2.8,        // kg alimento / kg ganado
    fcrAlerta: 3.2,
    fcrPeligro: 3.6,
    mortAlerta: 4,           // %
    mortPeligro: 7,
    precioKgCerdo: 1.6,      // USD/kg vivo
    costoKgAlimento: 0.35,   // USD/kg
  };

  // Calcula todos los KPIs de un lote. `nowISO` permite tests deterministas.
  function batchMetrics(b, targets, nowISO) {
    const t = Object.assign({}, DEFAULTS, targets || {});
    const now = nowISO ? new Date(nowISO) : new Date();
    const start = new Date(b.start_date + "T00:00:00");
    const days = Math.max(1, Math.round((now - start) / 86400000));

    const animalsAlive = Math.max(0, (b.animals_in || 0) - (b.deaths || 0));
    const hasWeigh = b.current_weight_kg != null && b.current_weight_date;
    const weighDays = hasWeigh
      ? Math.max(1, Math.round((new Date(b.current_weight_date + "T00:00:00") - start) / 86400000))
      : days;

    // ADG: real si hay pesada; si no, se asume el objetivo (estimacion).
    const weightNow = hasWeigh ? b.current_weight_kg : round1(b.weight_in_kg + t.adgObjetivo * days);
    const adg = round2((weightNow - b.weight_in_kg) / weighDays);
    const gainPerAnimal = round1(weightNow - b.weight_in_kg);
    const totalGain = round1(gainPerAnimal * animalsAlive);

    // IC / FCR
    const fcr = (b.feed_kg > 0 && totalGain > 0) ? round2(b.feed_kg / totalGain) : null;

    // Mortandad
    const mortalityPct = b.animals_in ? round1((b.deaths || 0) / b.animals_in * 100) : 0;

    // Proyeccion de faena al peso objetivo
    const remainingKg = round1(Math.max(0, b.target_weight_kg - weightNow));
    const adgForProj = adg > 0.1 ? adg : t.adgObjetivo;
    const projDays = remainingKg > 0 ? Math.ceil(remainingKg / adgForProj) : 0;
    const projDate = addDays(now, projDays);
    const readyToSlaughter = weightNow >= b.target_weight_kg;

    // Perdida vs objetivo: kg no ganados por ir por debajo del ADG objetivo.
    const adgGap = Math.max(0, t.adgObjetivo - adg);
    const lossKg = round1(adgGap * animalsAlive * days);
    const lossUsdGanancia = round1(lossKg * t.precioKgCerdo);
    // Alimento desperdiciado por IC peor que el objetivo.
    const extraFeedKg = (fcr && fcr > t.fcrObjetivo) ? round1((fcr - t.fcrObjetivo) * totalGain) : 0;
    const lossUsdAlimento = round1(extraFeedKg * t.costoKgAlimento);
    const lossUsdTotal = round1(lossUsdGanancia + lossUsdAlimento);

    return {
      days, animalsAlive, weightNow, weighDays, hasWeigh,
      adg, adgObjetivo: t.adgObjetivo, gainPerAnimal, totalGain,
      fcr, fcrObjetivo: t.fcrObjetivo,
      mortalityPct,
      remainingKg, projDays, projDate: projDate.toISOString().slice(0, 10), readyToSlaughter,
      lossKg, lossUsdGanancia, extraFeedKg, lossUsdAlimento, lossUsdTotal,
    };
  }

  // Alertas de rendimiento de un lote (para accionar).
  function batchAlerts(b, m, targets) {
    const t = Object.assign({}, DEFAULTS, targets || {});
    const out = [];
    if (m.hasWeigh && m.adg < t.adgObjetivo * 0.85) {
      out.push({ level: m.adg < t.adgObjetivo * 0.7 ? 2 : 1, kpi: "ADG",
        text: `Ganancia diaria baja: ${m.adg} kg/d (objetivo ${t.adgObjetivo}). Revisar alimentación, agua, sanidad y estrés térmico.` });
    }
    if (m.fcr != null && m.fcr >= t.fcrAlerta) {
      out.push({ level: m.fcr >= t.fcrPeligro ? 2 : 1, kpi: "IC",
        text: `Índice de conversión alto: ${m.fcr} (objetivo ${t.fcrObjetivo}). Estás gastando más alimento por kilo. Revisar desperdicio de comida, calidad del balanceado y calor.` });
    }
    if (m.mortalityPct >= t.mortAlerta) {
      out.push({ level: m.mortalityPct >= t.mortPeligro ? 2 : 1, kpi: "Mortandad",
        text: `Mortandad elevada: ${m.mortalityPct}%. Revisar sanidad, densidad y ambiente.` });
    }
    if (m.readyToSlaughter) {
      out.push({ level: 0, kpi: "Faena", text: `Lote en peso de faena (${m.weightNow} kg). Cada día extra empeora el IC: coordiná la salida.` });
    }
    return out;
  }

  // Resumen de varios lotes para el tablero.
  function rollup(batchesWithMetrics) {
    const active = batchesWithMetrics.filter((x) => x.batch.status === "active");
    const animals = active.reduce((a, x) => a + x.metrics.animalsAlive, 0);
    const lossUsd = round1(active.reduce((a, x) => a + x.metrics.lossUsdTotal, 0));
    const fcrs = active.map((x) => x.metrics.fcr).filter((v) => v != null);
    const adgs = active.map((x) => x.metrics.adg).filter((v) => v > 0);
    return {
      lotes: active.length, animals, lossUsd,
      fcrProm: fcrs.length ? round2(avg(fcrs)) : null,
      adgProm: adgs.length ? round2(avg(adgs)) : null,
    };
  }

  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

  return { DEFAULTS, batchMetrics, batchAlerts, rollup };
});
