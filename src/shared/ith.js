/* Piara — Motor ITH (Indice Temperatura-Humedad) para porcinos.
 * Fuente unica de verdad, usable en Node (backend) y en el navegador (frontend).
 *
 * Fundamento (relevamiento):
 *  - El cerdo no transpira -> muy sensible al calor. Se mide con ITH, no temperatura sola.
 *  - Zona confort adulto 18-25C; lechon lactante 30-34C; engorde 16-21C; cerda gestante sensible.
 *  - Umbrales porcinos: <74 confort | 74-78 alerta | 79-83 peligro | >=84 emergencia.
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod; // Node
  root.PiaraITH = mod; // Browser (window)
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Zona termoneutral y ajuste de sensibilidad por categoria animal.
  // ithOffset: cuanto se suma al ITH percibido segun cuan sensible es la categoria al calor.
  const CATEGORIES = {
    lechon:  { label: "Lechón lactante",  tmin: 30, tmax: 34, ithOffset: -2, coldSensitive: true  },
    recria:  { label: "Recría / destete", tmin: 24, tmax: 28, ithOffset: 0,  coldSensitive: true  },
    engorde: { label: "Engorde / capón",  tmin: 16, tmax: 21, ithOffset: 3,  coldSensitive: false },
    cerda:   { label: "Cerda / gestación",tmin: 16, tmax: 22, ithOffset: 4,  coldSensitive: false },
  };

  // Umbrales por defecto. Configurables por criadero: las funciones aceptan un
  // objeto `thr` opcional ({comfort, alert, emergency}); si no se pasa, usan estos.
  const THRESHOLDS = { comfort: 74, alert: 78, danger: 83, emergency: 84 };

  // Formula ITH clasica basada en Fahrenheit (NRC), estandar en porcinos:
  // ITH = (1.8*T + 32) - (0.55 - 0.0055*HR) * (1.8*T - 26)
  function computeITH(tempC, humidity) {
    const T = Number(tempC);
    const HR = clamp(Number(humidity), 0, 100);
    const ith = 1.8 * T + 32 - (0.55 - 0.0055 * HR) * (1.8 * T - 26);
    return Math.round(ith * 10) / 10;
  }

  // ITH ajustado a la categoria (lo que "siente" ese animal).
  function ithForCategory(tempC, humidity, category) {
    const cat = CATEGORIES[category] || CATEGORIES.engorde;
    return Math.round((computeITH(tempC, humidity) + cat.ithOffset) * 10) / 10;
  }

  // Severidad a partir de un valor de ITH ya ajustado.
  // Devuelve: level (0-3), key, label, color.
  function severityFromITH(ith, thr) {
    const t = thr || THRESHOLDS;
    const emergency = t.emergency != null ? t.emergency : 84;
    if (ith >= emergency) return { level: 3, key: "emergency", label: "Emergencia", color: "#c0392b" };
    if (ith > t.alert) return { level: 2, key: "danger", label: "Peligro", color: "#e67e22" };
    if (ith >= t.comfort) return { level: 1, key: "alert", label: "Alerta", color: "#f1c40f" };
    return { level: 0, key: "ok", label: "Confort", color: "#27ae60" };
  }

  // Evalua el estado de un galpon dado clima (o lectura de sensor) + categoria.
  function evaluateShed(shed, reading, thr) {
    const cat = CATEGORIES[shed.category] || CATEGORIES.engorde;
    const temp = Number(reading.temp);
    const humidity = Number(reading.humidity);
    const ith = ithForCategory(temp, humidity, shed.category);
    const sev = severityFromITH(ith, thr);

    const flags = [];
    // Frio (relevante en lechones/recria)
    if (cat.coldSensitive && temp < cat.tmin) {
      const gap = Math.round((cat.tmin - temp) * 10) / 10;
      flags.push({
        type: "cold",
        severity: gap > 6 ? 3 : gap > 3 ? 2 : 1,
        title: `Frío en ${cat.label.toLowerCase()}`,
        detail: `${temp} °C, ${gap} °C por debajo del mínimo (${cat.tmin} °C). Riesgo de aplastamiento y diarrea en lechones.`,
        actions: ["Encender/ajustar lámpara o placa calefactora", "Cerrar cortinas y cortar corrientes de aire", "Cama seca y abundante"],
      });
    }
    // Calor
    if (sev.level >= 1) {
      flags.push({
        type: "heat",
        severity: sev.level,
        title: `Estrés térmico (${sev.label}) - ITH ${ith}`,
        detail: heatDetail(sev.level, cat),
        actions: heatActions(sev.level),
      });
    }
    return { shedId: shed.id, ith, temp, humidity, severity: sev, flags, source: reading.source || "clima" };
  }

  function heatDetail(level, cat) {
    if (level >= 3) return `Estrés severo. Cae fuerte el consumo, sube mortalidad y se compromete la fertilidad de ${cat.label.toLowerCase()}.`;
    if (level === 2) return `Estrés moderado. Baja el consumo de alimento y la ganancia diaria de peso.`;
    return `Estrés ligero. Empieza a resentirse el consumo; conviene actuar antes de que escale.`;
  }
  function heatActions(level) {
    const base = ["Agua fresca y limpia a voluntad", "Correr la comida a la mañana temprano y el atardecer (evitar 10-16 h)"];
    if (level >= 2) base.push("Encender nebulizadores/goteo y ventilación forzada", "Bajar densidad si es posible");
    if (level >= 3) base.push("Mojar pisos y animales, agregar electrolitos al agua", "Guardia activa: es emergencia");
    return base;
  }

  // Genera alertas a nivel establecimiento a partir del pronostico horario (48h) y galpones.
  // forecast: [{ ts, temp, humidity, rainMm }]
  function buildAlerts(sheds, forecast, thr) {
    const t = thr || THRESHOLDS;
    const alerts = [];
    if (!forecast || !forecast.length) return alerts;

    // 1) Estres termico anticipado: primer horario en que algun galpon entra en peligro.
    for (const shed of sheds) {
      let firstBad = null;
      for (const f of forecast) {
        const ith = ithForCategory(f.temp, f.humidity, shed.category);
        if (ith > t.alert) { firstBad = { f, ith }; break; }
      }
      if (firstBad) {
        const hours = hoursFromNow(firstBad.f.ts);
        const sev = severityFromITH(firstBad.ith, t);
        alerts.push({
          type: "heat-forecast",
          shedId: shed.id,
          shedName: shed.name,
          severity: sev.level,
          when: firstBad.f.ts,
          title: `${shed.name}: ${sev.label} por calor en ~${hours} h`,
          message: `Se pronostica ITH ${firstBad.ith} (${sev.label}). Prepará ventilación/nebulización y adelantá la ración.`,
          actions: heatActions(sev.level),
        });
      }
    }

    // 2) Lluvia / anegamiento: suma mm en 24 h + saturacion de suelo (dato satelital).
    const next24 = forecast.slice(0, 24);
    const rain24 = round1(next24.reduce((a, f) => a + (f.rainMm || 0), 0));
    const soil = soilRisk(next24);
    if (rain24 >= 15 || soil.level >= 2) {
      // Suelo ya saturado agrava el efecto de la lluvia: sube un escalon de severidad.
      let sev = rain24 >= 50 ? 3 : rain24 >= 30 ? 2 : rain24 >= 15 ? 1 : 0;
      if (soil.level >= 2) sev = Math.min(3, sev + 1);
      if (sev >= 1) {
        alerts.push({
          type: "rain",
          severity: sev,
          title: rain24 >= 15
            ? `Lluvia fuerte pronosticada: ${rain24} mm en 24 h${soil.level >= 2 ? " (suelo saturado)" : ""}`
            : `Suelo saturado: riesgo de anegamiento`,
          message: `${soil.detail} Riesgo de anegamiento de callejones y corrales, barro y humedad.`,
          actions: ["Revisar drenajes y desagües", "Asegurar cama seca y techos", "Reforzar ración energética ante bajada de temperatura", "Controlar acceso de camiones (barro)"],
        });
      }
    }

    // 3) Frio para lechones: minima pronosticada.
    const hasLechon = sheds.some((s) => s.category === "lechon");
    if (hasLechon) {
      const minT = Math.min(...next24.map((f) => f.temp));
      if (minT < 8) {
        alerts.push({
          type: "cold",
          severity: minT < 2 ? 3 : minT < 5 ? 2 : 1,
          title: `Frío nocturno: mínima ${round1(minT)} °C`,
          message: `Maternidad en riesgo. Los lechones no regulan bien la temperatura.`,
          actions: ["Verificar lámparas/placas calefactoras", "Cerrar cortinas al atardecer", "Cama extra en nidos"],
        });
      }
    }

    // Orden: mas severo y mas cercano primero.
    alerts.sort((a, b) => b.severity - a.severity);
    return alerts;
  }

  // Riesgo de anegamiento por humedad de suelo (m3/m3) — dato satelital de Open-Meteo.
  // Umbrales orientativos para suelo franco: >0.40 saturado, 0.33-0.40 alto, 0.27-0.33 medio.
  function soilRisk(forecastWindow) {
    const vals = (forecastWindow || []).map((f) => f.soil).filter((v) => v != null);
    if (!vals.length) return { level: 0, label: "s/d", moisture: null, detail: "Sin dato de humedad de suelo." };
    const peak = Math.max(...vals);
    let level = 0, label = "Normal";
    if (peak >= 0.40) { level = 3; label = "Saturado"; }
    else if (peak >= 0.33) { level = 2; label = "Alto"; }
    else if (peak >= 0.27) { level = 1; label = "Medio"; }
    const detail = level >= 2
      ? `Humedad de suelo ${Math.round(peak * 100)}% (${label.toLowerCase()}).`
      : `Humedad de suelo ${Math.round(peak * 100)}%.`;
    return { level, label, moisture: Math.round(peak * 1000) / 1000, detail };
  }

  // Optimizador de alimentacion: marca por hora si conviene alimentar (fresco) o no (calor).
  function feedingPlan(forecastToday, thr) {
    const t = thr || THRESHOLDS;
    return forecastToday.map((f) => {
      const ith = computeITH(f.temp, f.humidity);
      const hour = hourOf(f.ts);
      let rec = "ok";
      if (ith > t.alert || (hour >= 10 && hour <= 16 && f.temp >= 26)) rec = "evitar";
      else if (ith >= t.comfort) rec = "precaucion";
      const good = hour <= 9 || hour >= 18; // ventanas frescas naturales
      return { ts: f.ts, hour, temp: f.temp, ith: round1(ith), rec, prime: good && rec === "ok" };
    });
  }

  // Impacto economico evitable por estres termico en las proximas 24 h.
  function economicImpact(sheds, forecast, econ, thr) {
    const t = thr || THRESHOLDS;
    const e = Object.assign({
      precioKgCerdo: 1.6, costoKgAlimento: 0.35,
      gananciaDiariaObjetivo: 0.85, perdidaGananciaPorPunto: 0.025,
    }, econ || {});
    const next24 = forecast.slice(0, 24);

    let animalesEnRiesgo = 0;
    let usdEnRiesgo = 0;
    const detalle = [];

    for (const shed of sheds) {
      if (shed.category === "lechon") continue; // impacto principal en engorde/recria/cerda
      // Promedio de "puntos sobre umbral" en el dia para ese galpon.
      let puntos = 0, n = 0;
      for (const f of next24) {
        const ith = ithForCategory(f.temp, f.humidity, shed.category);
        if (ith > t.comfort) { puntos += ith - t.comfort; n++; }
      }
      const puntoProm = n ? puntos / next24.length : 0;
      if (puntoProm <= 0) continue;
      const fraccion = Math.min(0.6, puntoProm * e.perdidaGananciaPorPunto);
      const kgPerdidos = e.gananciaDiariaObjetivo * fraccion * shed.animals;
      const usd = round1(kgPerdidos * e.precioKgCerdo);
      animalesEnRiesgo += shed.animals;
      usdEnRiesgo += usd;
      detalle.push({ shedName: shed.name, animals: shed.animals, kgPerdidos: round1(kgPerdidos), usd });
    }
    return {
      animalesEnRiesgo,
      usdDia: round1(usdEnRiesgo),
      usdMesProyectado: round1(usdEnRiesgo * 30),
      detalle,
    };
  }

  // Helpers
  function clamp(v, a, b) { return Math.max(a, Math.min(b, isNaN(v) ? a : v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function hoursFromNow(ts) { return Math.max(0, Math.round((new Date(ts).getTime() - Date.now()) / 3.6e6)); }
  // Hora local del reloj en el establecimiento: se lee de los digitos del ISO
  // ("...T14:00...-03:00" -> 14), sin depender de la zona horaria del proceso.
  function hourOf(ts) { const m = String(ts).match(/T(\d{2}):/); return m ? Number(m[1]) : new Date(ts).getHours(); }

  return {
    CATEGORIES, THRESHOLDS,
    computeITH, ithForCategory, severityFromITH, soilRisk,
    evaluateShed, buildAlerts, feedingPlan, economicImpact,
  };
});
