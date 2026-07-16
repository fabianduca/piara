/* Piara — Motor reproductivo porcino (cerdas).
 * Ciclo: servicio -> gestacion 114 dias (3-3-3) -> parto -> lactancia ~21 dias -> destete.
 * Valor: anticipar el parto para preparar la maternidad (lamparas, cama, limpieza) y no
 * perder lechones; ordenar el flujo de la sala de partos; medir prolificidad (nacidos vivos).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.PiaraRepro = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const GESTATION_DAYS = 114;   // 3 meses, 3 semanas, 3 dias
  const LACTATION_DAYS = 21;    // destete tipico

  function metrics(m, nowISO) {
    const now = nowISO ? new Date(nowISO + (nowISO.length <= 10 ? "T00:00:00" : "")) : new Date();
    const service = new Date(m.service_date + "T00:00:00");
    const expectedFarrow = addDays(service, GESTATION_DAYS);
    const out = {
      expectedFarrow: iso(expectedFarrow),
      gestDay: dayDiff(now, service),
      status: m.status,
    };

    if (m.status === "gestando") {
      out.daysToFarrow = dayDiff(expectedFarrow, now);
      out.overdue = out.daysToFarrow < -2;
      out.trimester = out.gestDay < 38 ? 1 : out.gestDay < 76 ? 2 : 3;
    } else if (m.status === "parida" && m.farrow_date) {
      const farrow = new Date(m.farrow_date + "T00:00:00");
      const expectedWean = addDays(farrow, LACTATION_DAYS);
      out.farrowDate = m.farrow_date;
      out.expectedWean = iso(expectedWean);
      out.daysToWean = dayDiff(expectedWean, now);
      out.lactDay = dayDiff(now, farrow);
      out.bornAlive = m.born_alive;
    } else if (m.status === "destetada") {
      out.bornAlive = m.born_alive;
      out.weaned = m.weaned;
    }
    return out;
  }

  // Alertas accionables por servicio.
  function alerts(m, mt) {
    const out = [];
    if (m.status === "gestando") {
      if (mt.overdue) {
        out.push({ level: 2, kind: "parto-atrasado",
          text: `Cerda ${m.sow_label}: parto atrasado (esperado ${mt.expectedFarrow}). Revisar urgente.` });
      } else if (mt.daysToFarrow <= 3) {
        out.push({ level: 2, kind: "parto-inminente",
          text: `Cerda ${m.sow_label}: pare en ${mt.daysToFarrow} día(s) (${mt.expectedFarrow}). Preparar paridera: limpieza, cama seca, lámpara/placa calefactora para lechones.` });
      } else if (mt.daysToFarrow <= 7) {
        out.push({ level: 1, kind: "parto-proximo",
          text: `Cerda ${m.sow_label}: pare en ${mt.daysToFarrow} días. Programar traslado a maternidad.` });
      }
    }
    if (m.status === "parida" && mt.daysToWean != null && mt.daysToWean <= 2 && mt.daysToWean >= 0) {
      out.push({ level: 1, kind: "destete",
        text: `Cerda ${m.sow_label}: destete en ${mt.daysToWean} día(s). Planificar y preparar próximo servicio.` });
    }
    return out;
  }

  // Resumen del plantel para el tablero.
  function rollup(list, nowISO) {
    const now = nowISO || undefined;
    let gestando = 0, lactando = 0, next7 = 0, next30 = 0, bornSum = 0, bornN = 0;
    for (const { m, mt } of list) {
      if (m.status === "gestando") {
        gestando++;
        if (mt.daysToFarrow >= 0 && mt.daysToFarrow <= 7) next7++;
        if (mt.daysToFarrow >= 0 && mt.daysToFarrow <= 30) next30++;
      }
      if (m.status === "parida") lactando++;
      if (m.born_alive != null) { bornSum += m.born_alive; bornN++; }
    }
    return {
      gestando, lactando,
      partosNext7: next7, partosNext30: next30,
      nacidosVivosProm: bornN ? Math.round((bornSum / bornN) * 10) / 10 : null,
    };
  }

  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((new Date(a) - new Date(b)) / 86400000); }

  return { GESTATION_DAYS, LACTATION_DAYS, metrics, alerts, rollup };
});
