/* Piara — Motor sanitario / plan de vacunacion.
 * Un plan sanitario cumplido a tiempo evita brotes, mortandad y caida de rendimiento.
 * Aca calculamos que esta al dia, que vence pronto y que esta vencido, y damos un plan
 * sugerido por categoria como punto de partida.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.PiaraHealth = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Plan sanitario sugerido por categoria (orientativo — el veterinario ajusta).
  const SUGGESTED = {
    cerda: [
      { title: "Parvovirus + Leptospira + Erisipela", kind: "vacuna", everyDays: 180 },
      { title: "Refuerzo pre-parto (E. coli / Clostridium)", kind: "vacuna", everyDays: 150 },
      { title: "Desparasitación", kind: "desparasitacion", everyDays: 120 },
    ],
    lechon: [
      { title: "Mycoplasma hyopneumoniae", kind: "vacuna", everyDays: 0 },
      { title: "Circovirus (PCV2)", kind: "vacuna", everyDays: 0 },
      { title: "Hierro (anemia)", kind: "tratamiento", everyDays: 0 },
    ],
    recria: [
      { title: "Refuerzo respiratorias", kind: "vacuna", everyDays: 0 },
      { title: "Desparasitación", kind: "desparasitacion", everyDays: 90 },
    ],
    engorde: [
      { title: "Control sanitario / revisión", kind: "revision", everyDays: 30 },
    ],
  };

  function eventStatus(e, nowISO) {
    const now = nowISO ? new Date(nowISO + "T00:00:00") : new Date();
    if (e.done) return { state: "hecho", daysToDue: null, level: 0 };
    if (!e.next_due) return { state: "sin-fecha", daysToDue: null, level: 0 };
    const due = new Date(e.next_due + "T00:00:00");
    const days = Math.round((due - now) / 86400000);
    if (days < 0) return { state: "vencido", daysToDue: days, level: 2 };
    if (days <= 7) return { state: "proximo", daysToDue: days, level: 1 };
    return { state: "al-dia", daysToDue: days, level: 0 };
  }

  function alertsFor(e, st, shedName) {
    if (st.level === 2) return [{ level: 2, text: `${shedName}: ${e.title} VENCIDA hace ${Math.abs(st.daysToDue)} día(s). Aplicar cuanto antes.` }];
    if (st.level === 1) return [{ level: 1, text: `${shedName}: ${e.title} vence en ${st.daysToDue} día(s).` }];
    return [];
  }

  function rollup(events) {
    let vencidos = 0, proximos = 0, alDia = 0;
    for (const { st } of events) {
      if (st.state === "vencido") vencidos++;
      else if (st.state === "proximo") proximos++;
      else if (st.state === "al-dia" || st.state === "hecho") alDia++;
    }
    return { total: events.length, vencidos, proximos, alDia };
  }

  return { SUGGESTED, eventStatus, alertsFor, rollup };
});
