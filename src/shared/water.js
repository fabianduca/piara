/* Piara — Motor de consumo de agua.
 * La caida del consumo de agua es la senal MAS TEMPRANA de problema (enfermedad, calor,
 * bebedero tapado): aparece antes que la caida de comida o cualquier sintoma visible.
 * Aca comparamos el consumo del dia contra el promedio reciente y contra el esperado por
 * categoria, y avisamos si cae.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.PiaraWater = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Litros/animal/dia orientativos por categoria (referencia de manejo porcino).
  const PER_ANIMAL = {
    lechon: 1.5,
    recria: 4,
    engorde: 8,
    cerda: 20,   // gestacion/lactancia consumen mucha agua (la lactancia mas)
  };

  // readings: [{ day, liters }] ordenadas por fecha ascendente. animals y category del galpon.
  function analyze(readings, category, animals) {
    if (!readings || !readings.length) {
      return { status: "sin-datos", latest: null, expected: expectedFor(category, animals) };
    }
    const sorted = readings.slice().sort((a, b) => (a.day < b.day ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    const prev = sorted.slice(0, -1).slice(-7); // hasta 7 dias previos
    const baseline = prev.length ? avg(prev.map((r) => r.liters)) : null;
    const expected = expectedFor(category, animals);

    let dropPct = null, level = 0, message = "Consumo normal.";
    if (baseline) {
      dropPct = Math.round((1 - latest.liters / baseline) * 100);
      if (dropPct >= 30) { level = 2; message = `Caída fuerte de agua: -${dropPct}% vs. promedio. Señal temprana de enfermedad, calor o bebedero tapado.`; }
      else if (dropPct >= 15) { level = 1; message = `Baja de agua: -${dropPct}% vs. promedio. Revisar bebederos y estado de los animales.`; }
      else if (dropPct <= -25) { level = 1; message = `Suba fuerte de agua: +${Math.abs(dropPct)}%. Suele indicar calor (más sed) o pérdida en la línea.`; }
    } else if (expected && latest.liters < expected * 0.6) {
      level = 1; message = `Consumo por debajo de lo esperado para la categoría.`;
    }

    const perAnimal = animals ? Math.round((latest.liters / animals) * 10) / 10 : null;
    return { status: "ok", latest, baseline: baseline != null ? round1(baseline) : null, expected, dropPct, perAnimal, level, message };
  }

  function expectedFor(category, animals) {
    const p = PER_ANIMAL[category] || PER_ANIMAL.engorde;
    return animals ? Math.round(p * animals) : null;
  }

  function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
  function round1(v) { return Math.round(v * 10) / 10; }

  return { PER_ANIMAL, analyze, expectedFor };
});
