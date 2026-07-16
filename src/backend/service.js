/* Piara — servicio de dominio: arma el dashboard de un site combinando
 * clima (Open-Meteo), lecturas de sensores por galpon y el motor ITH. */
const db = require("./db");
const weather = require("./weather");
const notify = require("./notify");
const ITH = require("../shared/ith");
const REPRO = require("../shared/repro");
const WATER = require("../shared/water");
const HEALTH = require("../shared/health");

// Ultima lectura de sensor para un galpon (si hay device y lectura reciente < 60 min).
function latestSensorReading(shedId) {
  const row = db.prepare(`
    SELECT r.temp, r.humidity, r.ts, d.name AS device_name
    FROM sensor_readings r
    JOIN devices d ON d.id = r.device_id
    WHERE d.shed_id = ?
    ORDER BY r.ts DESC LIMIT 1
  `).get(shedId);
  if (!row) return null;
  const ageMin = (Date.now() - new Date(row.ts + "Z").getTime()) / 60000;
  if (ageMin > 60) return { ...row, stale: true };
  return { ...row, stale: false };
}

// Umbrales ITH efectivos de un criadero: los configurados o el default global.
function tenantThresholds(tenantId) {
  const s = db.prepare("SELECT ith_comfort, ith_alert, ith_emergency FROM tenant_settings WHERE tenant_id = ?").get(tenantId) || {};
  const d = ITH.THRESHOLDS;
  return {
    comfort: s.ith_comfort != null ? s.ith_comfort : d.comfort,
    alert: s.ith_alert != null ? s.ith_alert : d.alert,
    emergency: s.ith_emergency != null ? s.ith_emergency : d.emergency,
  };
}

// Construye el dashboard completo para un site.
async function buildDashboard(site, { refresh = true } = {}) {
  const thr = tenantThresholds(site.tenant_id);
  let wx = weather.latestSnapshot(site.id);
  const ageMin = wx ? (Date.now() - new Date(wx.ts + "Z").getTime()) / 60000 : Infinity;
  if (refresh && ageMin > 15) {
    try { wx = await weather.refreshSite(site); wx = weather.latestSnapshot(site.id); }
    catch (e) { /* si falla la API, seguimos con lo ultimo guardado */ }
  }
  const current = wx?.current || { temp: null, humidity: null, rainMm: 0 };
  const hourly = wx?.hourly || [];

  const sheds = db.prepare("SELECT * FROM sheds WHERE site_id = ?").all(site.id);

  // Estado por galpon: usa sensor interior si existe y es fresco; si no, clima exterior.
  const shedStates = sheds.map((shed) => {
    const sensor = latestSensorReading(shed.id);
    const reading = sensor && !sensor.stale
      ? { temp: sensor.temp, humidity: sensor.humidity, source: "sensor" }
      : { temp: current.temp, humidity: current.humidity, source: "clima" };
    const evalRes = ITH.evaluateShed(shed, reading, thr);
    // Horas de estres termico pronosticadas en 48h para esta categoria (exposicion -> perdida).
    let stressHours = 0;
    for (const f of hourly) {
      if (ITH.ithForCategory(f.temp, f.humidity, shed.category) > thr.alert) stressHours++;
    }
    return {
      ...shed,
      ...evalRes,
      stressHours48: stressHours,
      sensor: sensor ? { name: sensor.device_name, ts: sensor.ts, stale: sensor.stale, temp: sensor.temp, humidity: sensor.humidity } : null,
    };
  });

  const alerts = ITH.buildAlerts(sheds, hourly, thr);
  persistAlerts(site, alerts);

  // Capa satelital: riesgo de anegamiento por humedad de suelo (proximas 24 h).
  const soil = ITH.soilRisk(hourly.slice(0, 24));

  // Pronostico ITH 48h (a nivel exterior) para el grafico.
  const ithForecast = hourly.map((f) => ({ ts: f.ts, ith: ITH.computeITH(f.temp, f.humidity), temp: f.temp, rainMm: f.rainMm }));

  // Plan de alimentacion del dia (proximas ~18h)
  const today = hourly.slice(0, 18);
  const feeding = ITH.feedingPlan(today, thr);

  const economics = ITH.economicImpact(sheds, hourly, {}, thr);

  const worst = shedStates.reduce((m, s) => (s.severity.level > m ? s.severity.level : m), 0);

  return {
    site: { id: site.id, name: site.name, lat: site.lat, lon: site.lon },
    updatedAt: wx?.ts || null,
    current,
    soil,
    overall: ITH.severityFromITH(current.temp != null ? ITH.computeITH(current.temp, current.humidity) : 0, thr),
    worstShedLevel: worst,
    sheds: shedStates,
    alerts,
    ithForecast,
    feeding,
    economics,
    thresholds: thr,
  };
}

// Guarda alertas nuevas (evita duplicar la misma alerta activa del mismo tipo/galpon en 3h).
// Devuelve las alertas que fueron realmente nuevas (para notificar).
function persistAlerts(site, alerts) {
  const siteId = site.id;
  const insert = db.prepare(`
    INSERT INTO alerts (site_id, shed_id, type, severity, title, message, actions_json)
    VALUES (@site_id, @shed_id, @type, @severity, @title, @message, @actions_json)
  `);
  const findRecent = db.prepare(`
    SELECT id FROM alerts WHERE site_id = ? AND type = ? AND IFNULL(shed_id,0) = ?
    AND resolved = 0 AND created_at > datetime('now','-3 hours') LIMIT 1
  `);
  const fresh = [];
  // Claves (tipo + galpon) de las condiciones activas en este ciclo.
  const currentKeys = new Set(alerts.map((a) => `${a.type}:${a.shedId ? shedIdByName(siteId, a.shedName) || 0 : 0}`));
  const tx = db.transaction((list) => {
    for (const a of list) {
      const shedId = a.shedId ? shedIdByName(siteId, a.shedName) : null;
      if (findRecent.get(siteId, a.type, shedId || 0)) continue;
      insert.run({
        site_id: siteId, shed_id: shedId, type: a.type, severity: a.severity,
        title: a.title, message: a.message || "", actions_json: JSON.stringify(a.actions || []),
      });
      fresh.push(a);
    }
    // Auto-resolucion: toda alerta abierta cuya condicion ya no aparece se marca resuelta.
    // Asi el historial refleja estados reales (nueva -> activa -> resuelta) y no crece indefinido.
    const open = db.prepare("SELECT id, type, shed_id FROM alerts WHERE site_id = ? AND resolved = 0").all(siteId);
    const resolve = db.prepare("UPDATE alerts SET resolved = 1, resolved_at = datetime('now') WHERE id = ?");
    for (const row of open) {
      if (!currentKeys.has(`${row.type}:${row.shed_id || 0}`)) resolve.run(row.id);
    }
  });
  tx(alerts);

  if (fresh.length) notifyFreshAlerts(site, fresh);
  return fresh;
}

// Encola avisos WhatsApp para las alertas nuevas que superan la severidad minima del criadero.
function notifyFreshAlerts(site, fresh) {
  const settings = db.prepare("SELECT whatsapp, notify_min_severity FROM tenant_settings WHERE tenant_id = ?").get(site.tenant_id)
    || { whatsapp: null, notify_min_severity: 2 };
  const min = settings.notify_min_severity ?? 2;
  for (const a of fresh) {
    if (a.severity < min) continue;
    const emoji = ["", "🟡", "🟠", "🔴"][a.severity] || "⚠️";
    const body = `${a.message || ""}\nQué hacer: ${(a.actions || []).slice(0, 3).join("; ")}\n— Piara · ${site.name}`;
    notify.enqueue({
      tenantId: site.tenant_id, siteId: site.id, recipient: settings.whatsapp,
      title: `${emoji} ${a.title}`, body,
    }).catch(() => {});
  }
}

function shedIdByName(siteId, name) {
  const row = db.prepare("SELECT id FROM sheds WHERE site_id = ? AND name = ?").get(siteId, name);
  return row ? row.id : null;
}

// Escaneo de avisos de dominio (reproduccion, agua, sanidad) para TODOS los sites.
// Vive en un job de fondo para que los GET de la API sean lecturas puras (idempotentes):
// antes, abrir /repro, /water o /health disparaba WhatsApp como efecto secundario.
// enqueueOnce dedup 12 h, asi que correrlo cada 30 min no genera spam.
function scanDomainNotifications() {
  const sites = db.prepare("SELECT id, tenant_id, name, feed_low_kg FROM sites").all();
  for (const site of sites) {
    const settings = db.prepare("SELECT whatsapp FROM tenant_settings WHERE tenant_id = ?").get(site.tenant_id) || {};
    const args = { tenantId: site.tenant_id, siteId: site.id, recipient: settings.whatsapp };

    // Stock de alimento bajo.
    if (site.feed_low_kg != null) {
      const bal = db.prepare("SELECT COALESCE(SUM(kg),0) AS b FROM feed_moves WHERE site_id = ?").get(site.id).b;
      if (bal <= site.feed_low_kg) {
        notify.enqueueOnce({ ...args, title: `🌾 Stock de alimento bajo`, body: `${site.name}: quedan ${Math.round(bal)} kg de alimento (umbral ${Math.round(site.feed_low_kg)} kg). Reponé para no cortar la ración.` }).catch(() => {});
      }
    }

    // Stock de medicamentos bajo (por producto con umbral).
    const medItems = db.prepare("SELECT id, name, unit, low_qty FROM med_items WHERE site_id = ? AND low_qty IS NOT NULL").all(site.id);
    for (const it of medItems) {
      const bal = db.prepare("SELECT COALESCE(SUM(qty),0) AS b FROM med_moves WHERE item_id = ?").get(it.id).b;
      if (bal <= it.low_qty) {
        notify.enqueueOnce({ ...args, title: `💊 Stock bajo: ${it.name}`, body: `${site.name}: quedan ${Math.round(bal)} ${it.unit} de ${it.name} (umbral ${Math.round(it.low_qty)}). Reponé el stock sanitario.` }).catch(() => {});
      }
    }

    // Reproduccion: partos inminentes (nivel >= 2).
    const matings = db.prepare(`
      SELECT m.*, s.name AS shed_name FROM matings m
      JOIN sheds s ON s.id = m.shed_id WHERE s.site_id = ?
    `).all(site.id);
    for (const m of matings) {
      for (const a of REPRO.alerts(m, REPRO.metrics(m))) {
        if (a.level >= 2) notify.enqueueOnce({ ...args, title: `🐷 ${a.text.split(":")[0]}`, body: a.text }).catch(() => {});
      }
    }

    // Agua: caida fuerte (nivel >= 2).
    const sheds = db.prepare("SELECT * FROM sheds WHERE site_id = ?").all(site.id);
    for (const shed of sheds) {
      const readings = db.prepare("SELECT day, liters FROM water_readings WHERE shed_id = ? ORDER BY day DESC LIMIT 14").all(shed.id).reverse();
      const analysis = WATER.analyze(readings, shed.category, shed.animals);
      if (analysis.level >= 2) notify.enqueueOnce({ ...args, title: `💧 Agua ${shed.name}`, body: `${shed.name}: ${analysis.message}` }).catch(() => {});
    }

    // Sanidad: eventos vencidos (nivel >= 2).
    const events = db.prepare(`
      SELECT h.*, s.name AS shed_name FROM health_events h
      JOIN sheds s ON s.id = h.shed_id WHERE s.site_id = ?
    `).all(site.id);
    for (const e of events) {
      for (const a of HEALTH.alertsFor(e, HEALTH.eventStatus(e), e.shed_name)) {
        if (a.level >= 2) notify.enqueueOnce({ ...args, title: `💉 Sanidad vencida`, body: a.text }).catch(() => {});
      }
    }
  }
}

module.exports = { buildDashboard, latestSensorReading, scanDomainNotifications };
