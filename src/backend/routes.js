/* Piara — rutas de la API. */
const express = require("express");
const db = require("./db");
const auth = require("./auth");
const service = require("./service");
const weather = require("./weather");
const notify = require("./notify");
const ITH = require("../shared/ith");
const PROD = require("../shared/production");
const REPRO = require("../shared/repro");
const WATER = require("../shared/water");
const HEALTH = require("../shared/health");

const router = express.Router();

// Verifica que un galpon pertenezca al criadero del usuario.
function ownedShed(shedId, tenantId) {
  return db.prepare(`
    SELECT s.* FROM sheds s JOIN sites si ON si.id = s.site_id
    WHERE s.id = ? AND si.tenant_id = ?
  `).get(shedId, tenantId);
}
function ownedBatch(batchId, tenantId) {
  return db.prepare(`
    SELECT b.* FROM batches b JOIN sheds s ON s.id = b.shed_id
    JOIN sites si ON si.id = s.site_id
    WHERE b.id = ? AND si.tenant_id = ?
  `).get(batchId, tenantId);
}
function ownedMating(id, tenantId) {
  return db.prepare(`
    SELECT m.* FROM matings m JOIN sheds s ON s.id = m.shed_id
    JOIN sites si ON si.id = s.site_id WHERE m.id = ? AND si.tenant_id = ?
  `).get(id, tenantId);
}
function siteTenant(siteId, tenantId) {
  return db.prepare("SELECT * FROM sites WHERE id = ? AND tenant_id = ?").get(siteId, tenantId);
}

/* ---------- Auth ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rate limiter simple en memoria (proceso unico): frena fuerza bruta de login.
// Ventana deslizante por IP; se limpia solo. No reemplaza un limiter de infra,
// pero cubre el caso basico sin agregar dependencias.
const rlHits = new Map();
function rateLimit({ windowMs = 60000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const arr = (rlHits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "Demasiados intentos. Esperá un minuto." });
    arr.push(now);
    rlHits.set(key, arr);
    if (rlHits.size > 5000) rlHits.clear(); // cota de memoria
    next();
  };
}
const authLimiter = rateLimit({ windowMs: 60000, max: 10 });

router.post("/auth/register", authLimiter, (req, res) => {
  const { criadero, email, password, lat, lon } = req.body || {};
  if (!criadero || !email || !password) return res.status(400).json({ error: "Faltan datos (criadero, email, password)" });
  if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: "El email no tiene un formato válido" });
  if (String(password).length < 4) return res.status(400).json({ error: "La contraseña debe tener al menos 4 caracteres" });
  if (String(criadero).length > 120) return res.status(400).json({ error: "El nombre del criadero es demasiado largo" });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: "Ese email ya está registrado" });

  const tx = db.transaction(() => {
    const t = db.prepare("INSERT INTO tenants (name) VALUES (?)").run(criadero);
    const tenantId = t.lastInsertRowid;
    const u = db.prepare(
      "INSERT INTO users (tenant_id, email, pass_hash) VALUES (?, ?, ?)"
    ).run(tenantId, email.toLowerCase(), auth.hashPassword(password));
    // Site por defecto (San Andres de Giles si no se especifica).
    const s = db.prepare("INSERT INTO sites (tenant_id, name, lat, lon) VALUES (?, ?, ?, ?)")
      .run(tenantId, criadero, lat || -34.4458, lon || -59.4460);
    return { userId: u.lastInsertRowid, tenantId, siteId: s.lastInsertRowid };
  });
  const ids = tx();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(ids.userId);
  res.json({ token: auth.signToken(user), email: user.email, criadero });
});

router.post("/auth/login", authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!user || !auth.checkPassword(password || "", user.pass_hash))
    return res.status(401).json({ error: "Email o contraseña incorrectos" });
  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(user.tenant_id);
  res.json({ token: auth.signToken(user), email: user.email, criadero: tenant.name });
});

/* ---------- Sites / dashboard ---------- */
router.get("/sites", auth.requireAuth, (req, res) => {
  const sites = db.prepare("SELECT id, name, lat, lon FROM sites WHERE tenant_id = ?").all(req.user.tid);
  res.json({ sites });
});

router.get("/sites/:id/dashboard", auth.requireAuth, async (req, res) => {
  const site = db.prepare("SELECT * FROM sites WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "Establecimiento no encontrado" });
  try {
    const dash = await service.buildDashboard(site);
    res.json(dash);
  } catch (e) {
    res.status(500).json({ error: "Error armando el dashboard", detail: String(e.message || e) });
  }
});

/* ---------- Sheds ---------- */
router.get("/sites/:id/sheds", auth.requireAuth, (req, res) => {
  const site = db.prepare("SELECT id FROM sites WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  res.json({ sheds: db.prepare("SELECT * FROM sheds WHERE site_id = ?").all(site.id) });
});

router.post("/sites/:id/sheds", auth.requireAuth, (req, res) => {
  const site = db.prepare("SELECT id FROM sites WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const { name, category, animals, note } = req.body || {};
  if (!name || !category) return res.status(400).json({ error: "Faltan nombre y categoría" });
  const r = db.prepare("INSERT INTO sheds (site_id, name, category, animals, note) VALUES (?, ?, ?, ?, ?)")
    .run(site.id, name, category, animals || 0, note || "");
  res.json({ id: r.lastInsertRowid });
});

/* ---------- Devices (sensores) ---------- */
router.get("/sites/:id/devices", auth.requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, s.name AS shed_name FROM devices d
    JOIN sheds s ON s.id = d.shed_id
    JOIN sites si ON si.id = s.site_id
    WHERE si.id = ? AND si.tenant_id = ?
  `).all(req.params.id, req.user.tid);
  res.json({ devices: rows });
});

router.post("/sheds/:shedId/devices", auth.requireAuth, (req, res) => {
  const shed = db.prepare(`
    SELECT s.id FROM sheds s JOIN sites si ON si.id = s.site_id
    WHERE s.id = ? AND si.tenant_id = ?
  `).get(req.params.shedId, req.user.tid);
  if (!shed) return res.status(404).json({ error: "Galpón no encontrado" });
  const key = auth.newApiKey();
  const r = db.prepare("INSERT INTO devices (shed_id, name, api_key, kind) VALUES (?, ?, ?, ?)")
    .run(shed.id, (req.body && req.body.name) || "Sensor", key, "temp_humidity");
  res.json({ id: r.lastInsertRowid, api_key: key });
});

/* ---------- Ingesta de sensores (autenticada por api_key del dispositivo) ---------- */
// Rangos fisicos plausibles: fuera de esto la lectura se rechaza para no
// contaminar el historial ni disparar alertas falsas (p.ej. temp=9999).
const RANGE = { temp: [-30, 55], humidity: [0, 100], water_l: [0, 1e6] };
function inRange(k, v) { const r = RANGE[k]; return typeof v === "number" && !isNaN(v) && v >= r[0] && v <= r[1]; }

router.post("/ingest", auth.requireDevice, (req, res) => {
  const { temp, humidity, extra, water_l } = req.body || {};
  if (temp == null && humidity == null && water_l == null)
    return res.status(400).json({ error: "Se requiere temp, humidity y/o water_l" });
  // Validacion de rango: rechaza valores imposibles (sensor con falla o ataque).
  for (const [k, v] of [["temp", temp], ["humidity", humidity], ["water_l", water_l]]) {
    if (v != null && !inRange(k, v))
      return res.status(422).json({ error: `Lectura de ${k} fuera de rango físico (${RANGE[k][0]}..${RANGE[k][1]})`, rejected: k, value: v });
  }
  if (temp != null || humidity != null) {
    db.prepare("INSERT INTO sensor_readings (device_id, temp, humidity, extra) VALUES (?, ?, ?, ?)")
      .run(req.device.id, temp ?? null, humidity ?? null, extra ? JSON.stringify(extra) : null);
  }
  // Caudalimetro: acumula litros del dia para el galpon del dispositivo.
  if (water_l != null) {
    const day = new Date().toISOString().slice(0, 10);
    db.prepare("DELETE FROM water_readings WHERE shed_id = ? AND day = ? AND source='sensor'").run(req.device.shed_id, day);
    db.prepare("INSERT INTO water_readings (shed_id, day, liters, source) VALUES (?, ?, ?, 'sensor')").run(req.device.shed_id, day, water_l);
  }
  db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(req.device.id);
  res.json({ ok: true });
});

/* ---------- Cuenta / avisos (WhatsApp) ---------- */
router.get("/account", auth.requireAuth, (req, res) => {
  const tenant = db.prepare("SELECT id, name, plan, sub_status, sub_price_usd FROM tenants WHERE id = ?").get(req.user.tid);
  const settings = db.prepare("SELECT whatsapp, notify_min_severity, ith_comfort, ith_alert, ith_emergency FROM tenant_settings WHERE tenant_id = ?").get(req.user.tid)
    || { whatsapp: null, notify_min_severity: 2 };
  // Umbrales efectivos (los configurados o el default global) para mostrar en el form.
  const d = ITH.THRESHOLDS;
  const thresholds = {
    comfort: settings.ith_comfort != null ? settings.ith_comfort : d.comfort,
    alert: settings.ith_alert != null ? settings.ith_alert : d.alert,
    emergency: settings.ith_emergency != null ? settings.ith_emergency : d.emergency,
    defaults: { comfort: d.comfort, alert: d.alert, emergency: d.emergency },
  };
  res.json({ tenant, settings, thresholds, notifier: notify.providerStatus(), me: { uid: req.user.uid, email: req.user.email, role: req.user.role } });
});

/* ---------- Gestion de usuarios / equipo (solo owner) ---------- */
const ROLES = ["owner", "veterinario", "operario"];
router.get("/users", auth.requireAuth, auth.requireRole("owner"), (req, res) => {
  const users = db.prepare("SELECT id, email, role, created_at FROM users WHERE tenant_id = ? ORDER BY id").all(req.user.tid);
  res.json({ users });
});

router.post("/users", auth.requireAuth, auth.requireRole("owner"), (req, res) => {
  const b = req.body || {};
  const email = String(b.email || "").toLowerCase().trim();
  const role = ROLES.includes(b.role) ? b.role : "operario";
  if (!EMAIL_RE.test(email)) return res.status(422).json({ error: "Email inválido" });
  if (!b.password || String(b.password).length < 4) return res.status(422).json({ error: "La contraseña debe tener al menos 4 caracteres" });
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return res.status(409).json({ error: "Ese email ya está registrado" });
  const r = db.prepare("INSERT INTO users (tenant_id, email, pass_hash, role) VALUES (?, ?, ?, ?)")
    .run(req.user.tid, email, auth.hashPassword(b.password), role);
  res.json({ id: r.lastInsertRowid, email, role });
});

router.post("/users/:id/role", auth.requireAuth, auth.requireRole("owner"), (req, res) => {
  const b = req.body || {};
  if (!ROLES.includes(b.role)) return res.status(422).json({ error: "Rol inválido" });
  const target = db.prepare("SELECT id, role FROM users WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  // No permitir quedarse sin ningún owner.
  if (target.role === "owner" && b.role !== "owner") {
    const owners = db.prepare("SELECT COUNT(*) n FROM users WHERE tenant_id = ? AND role = 'owner'").get(req.user.tid).n;
    if (owners <= 1) return res.status(409).json({ error: "Debe quedar al menos un dueño (owner) en el criadero" });
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(b.role, target.id);
  res.json({ ok: true });
});

router.delete("/users/:id", auth.requireAuth, auth.requireRole("owner"), (req, res) => {
  if (Number(req.params.id) === req.user.uid) return res.status(409).json({ error: "No podés eliminar tu propio usuario" });
  const target = db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
  res.json({ ok: true });
});

// Guarda los umbrales ITH del criadero (o los resetea a default con null).
router.post("/account/thresholds", auth.requireAuth, auth.requireRole("owner"), (req, res) => {
  const b = req.body || {};
  if (b.reset) {
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, ith_comfort, ith_alert, ith_emergency) VALUES (?, NULL, NULL, NULL)
      ON CONFLICT(tenant_id) DO UPDATE SET ith_comfort = NULL, ith_alert = NULL, ith_emergency = NULL
    `).run(req.user.tid);
    return res.json({ ok: true, reset: true });
  }
  const comfort = Number(b.comfort), alert = Number(b.alert), emergency = Number(b.emergency);
  for (const v of [comfort, alert, emergency]) {
    if (isNaN(v) || v < 50 || v > 100) return res.status(422).json({ error: "Los umbrales deben ser números entre 50 y 100 (puntos ITH)" });
  }
  if (!(comfort < alert && alert < emergency))
    return res.status(422).json({ error: "Debe cumplirse: confort < peligro < emergencia" });
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, ith_comfort, ith_alert, ith_emergency) VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET ith_comfort = excluded.ith_comfort, ith_alert = excluded.ith_alert, ith_emergency = excluded.ith_emergency
  `).run(req.user.tid, comfort, alert, emergency);
  res.json({ ok: true });
});

router.post("/account/whatsapp", auth.requireAuth, auth.requireRole("owner"), (req, res) => {
  const { whatsapp, minSeverity } = req.body || {};
  const min = Math.max(1, Math.min(3, Number(minSeverity) || 2));
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, whatsapp, notify_min_severity) VALUES (?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET whatsapp = excluded.whatsapp, notify_min_severity = excluded.notify_min_severity
  `).run(req.user.tid, (whatsapp || "").trim() || null, min);
  res.json({ ok: true });
});

router.get("/notifications", auth.requireAuth, (req, res) => {
  res.json({ notifications: notify.recent(req.user.tid), notifier: notify.providerStatus() });
});

// Envia un aviso de prueba al numero configurado (o lo deja en la bandeja).
router.post("/notifications/test", auth.requireAuth, async (req, res) => {
  const settings = db.prepare("SELECT whatsapp FROM tenant_settings WHERE tenant_id = ?").get(req.user.tid);
  const site = db.prepare("SELECT id FROM sites WHERE tenant_id = ? LIMIT 1").get(req.user.tid);
  await notify.enqueue({
    tenantId: req.user.tid, siteId: site && site.id, recipient: settings && settings.whatsapp,
    title: "✅ Prueba de Piara", body: "Si ves esto, los avisos están configurados. — Piara",
  });
  res.json({ ok: true, sent: notify.providerReady });
});

/* ---------- Produccion / rendimiento (lotes) ---------- */
router.get("/sites/:id/production", auth.requireAuth, (req, res) => {
  const site = db.prepare("SELECT id FROM sites WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const rows = db.prepare(`
    SELECT b.*, s.name AS shed_name, s.category FROM batches b
    JOIN sheds s ON s.id = b.shed_id WHERE s.site_id = ? ORDER BY b.status, b.start_date DESC
  `).all(site.id);
  const batches = rows.map((b) => {
    const metrics = PROD.batchMetrics(b);
    const alerts = PROD.batchAlerts(b, metrics);
    return { batch: b, metrics, alerts };
  });
  res.json({ batches, rollup: PROD.rollup(batches) });
});

router.post("/sheds/:shedId/batches", auth.requireAuth, (req, res) => {
  const shed = ownedShed(req.params.shedId, req.user.tid);
  if (!shed) return res.status(404).json({ error: "Galpón no encontrado" });
  const b = req.body || {};
  if (!b.name || !b.start_date || !b.animals_in || !b.weight_in_kg)
    return res.status(400).json({ error: "Faltan datos (nombre, fecha inicio, animales, peso entrada)" });
  // Integridad: valores numericos plausibles (evita KPIs sin sentido).
  const animals = Number(b.animals_in), win = Number(b.weight_in_kg);
  const wtarget = Number(b.target_weight_kg || 110), feed = Number(b.feed_kg || 0), deaths = Number(b.deaths || 0);
  if (!(animals > 0) || !(win > 0) || feed < 0 || deaths < 0)
    return res.status(422).json({ error: "Valores inválidos: animales y peso deben ser positivos; alimento y bajas no pueden ser negativos" });
  if (deaths > animals)
    return res.status(422).json({ error: "Las bajas no pueden superar los animales del lote" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start_date))
    return res.status(422).json({ error: "Fecha de inicio inválida (formato YYYY-MM-DD)" });
  const r = db.prepare(`
    INSERT INTO batches (shed_id, name, start_date, animals_in, weight_in_kg, target_weight_kg, feed_kg, deaths, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(shed.id, b.name, b.start_date, animals, win, wtarget, feed, deaths, req.user.uid);
  res.json({ id: r.lastInsertRowid });
});

// Actualizar avances del lote: alimento acumulado, bajas, ultima pesada.
router.post("/batches/:id/update", auth.requireAuth, (req, res) => {
  const batch = ownedBatch(req.params.id, req.user.tid);
  if (!batch) return res.status(404).json({ error: "Lote no encontrado" });
  const b = req.body || {};
  const feed = b.feed_kg != null ? Number(b.feed_kg) : batch.feed_kg;
  const deaths = b.deaths != null ? Number(b.deaths) : batch.deaths;
  const cw = b.current_weight_kg != null ? Number(b.current_weight_kg) : batch.current_weight_kg;
  const cwDate = b.current_weight_kg != null ? (b.current_weight_date || new Date().toISOString().slice(0, 10)) : batch.current_weight_date;
  if (feed < 0 || deaths < 0) return res.status(422).json({ error: "Alimento y bajas no pueden ser negativos" });
  if (deaths > batch.animals_in) return res.status(422).json({ error: "Las bajas no pueden superar los animales del lote" });
  db.prepare(`
    UPDATE batches SET feed_kg = ?, deaths = ?, current_weight_kg = ?, current_weight_date = ? WHERE id = ?
  `).run(feed, deaths, cw, cwDate, batch.id);
  // Descuento automatico de stock: si el criadero lo tiene activado y subio el
  // alimento acumulado del lote, se registra el delta como egreso 'auto'.
  const site = db.prepare("SELECT si.id, si.feed_auto FROM sites si JOIN sheds s ON s.site_id = si.id WHERE s.id = ?").get(batch.shed_id);
  const delta = Math.round((feed - batch.feed_kg) * 10) / 10;
  if (site && site.feed_auto && delta > 0) {
    db.prepare("INSERT INTO feed_moves (site_id, kg, kind, note, batch_id, created_by) VALUES (?, ?, 'auto', ?, ?, ?)")
      .run(site.id, -delta, `Consumo lote ${batch.name}`, batch.id, req.user.uid);
  }
  const updated = db.prepare("SELECT * FROM batches WHERE id = ?").get(batch.id);
  res.json({ ok: true, metrics: PROD.batchMetrics(updated) });
});

router.post("/batches/:id/close", auth.requireAuth, (req, res) => {
  const batch = ownedBatch(req.params.id, req.user.tid);
  if (!batch) return res.status(404).json({ error: "Lote no encontrado" });
  db.prepare("UPDATE batches SET status = 'closed' WHERE id = ?").run(batch.id);
  res.json({ ok: true });
});

/* ---------- Reproduccion (cerdas) ---------- */
router.get("/sites/:id/repro", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const rows = db.prepare(`
    SELECT m.*, s.name AS shed_name FROM matings m
    JOIN sheds s ON s.id = m.shed_id WHERE s.site_id = ?
    ORDER BY (m.status='gestando') DESC, m.service_date
  `).all(site.id);
  const list = rows.map((m) => {
    const mt = REPRO.metrics(m);
    return { m, mt, alerts: REPRO.alerts(m, mt) };
  });
  // Los avisos de partos inminentes los dispara el job de fondo (service.scanDomainNotifications),
  // no este GET: asi la lectura es idempotente.
  res.json({ matings: list, rollup: REPRO.rollup(list) });
});

router.post("/sheds/:shedId/matings", auth.requireAuth, (req, res) => {
  const shed = ownedShed(req.params.shedId, req.user.tid);
  if (!shed) return res.status(404).json({ error: "Galpón no encontrado" });
  const b = req.body || {};
  if (!b.sow_label || !b.service_date) return res.status(400).json({ error: "Faltan caravana y fecha de servicio" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.service_date))
    return res.status(422).json({ error: "Fecha de servicio inválida (formato YYYY-MM-DD)" });
  // Evita estados reproductivos contradictorios: una cerda no puede tener dos
  // ciclos activos (gestando/parida) al mismo tiempo en el criadero.
  const activa = db.prepare(`
    SELECT m.id FROM matings m JOIN sheds s ON s.id = m.shed_id
    JOIN sites si ON si.id = s.site_id
    WHERE si.tenant_id = ? AND m.sow_label = ? AND m.status IN ('gestando','parida') LIMIT 1
  `).get(req.user.tid, b.sow_label);
  if (activa) return res.status(409).json({ error: `La cerda ${b.sow_label} ya tiene un ciclo activo (gestando o en lactancia). Cerrá el ciclo anterior primero.` });
  const r = db.prepare("INSERT INTO matings (shed_id, sow_label, service_date, note, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(shed.id, b.sow_label, b.service_date, b.note || "", req.user.uid);
  res.json({ id: r.lastInsertRowid });
});

router.post("/matings/:id/farrow", auth.requireAuth, (req, res) => {
  const m = ownedMating(req.params.id, req.user.tid);
  if (!m) return res.status(404).json({ error: "Servicio no encontrado" });
  const b = req.body || {};
  db.prepare("UPDATE matings SET status='parida', farrow_date=?, born_alive=?, born_dead=? WHERE id=?")
    .run(b.farrow_date || new Date().toISOString().slice(0, 10), b.born_alive ?? null, b.born_dead ?? null, m.id);
  res.json({ ok: true });
});

router.post("/matings/:id/wean", auth.requireAuth, (req, res) => {
  const m = ownedMating(req.params.id, req.user.tid);
  if (!m) return res.status(404).json({ error: "Servicio no encontrado" });
  const b = req.body || {};
  db.prepare("UPDATE matings SET status='destetada', wean_date=?, weaned=? WHERE id=?")
    .run(b.wean_date || new Date().toISOString().slice(0, 10), b.weaned ?? null, m.id);
  res.json({ ok: true });
});

/* ---------- Consumo de agua ---------- */
router.get("/sites/:id/water", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const sheds = db.prepare("SELECT * FROM sheds WHERE site_id = ?").all(site.id);
  const result = sheds.map((shed) => {
    const readings = db.prepare("SELECT day, liters FROM water_readings WHERE shed_id = ? ORDER BY day DESC LIMIT 14").all(shed.id).reverse();
    const analysis = WATER.analyze(readings, shed.category, shed.animals);
    // Los avisos de caida de agua los dispara el job de fondo, no este GET.
    return { shed: { id: shed.id, name: shed.name, category: shed.category, animals: shed.animals }, analysis, readings };
  });
  res.json({ sheds: result });
});

router.post("/sheds/:shedId/water", auth.requireAuth, (req, res) => {
  const shed = ownedShed(req.params.shedId, req.user.tid);
  if (!shed) return res.status(404).json({ error: "Galpón no encontrado" });
  const b = req.body || {};
  if (b.liters == null) return res.status(400).json({ error: "Falta litros" });
  const liters = Number(b.liters);
  if (!(liters >= 0) || liters > 1e6) return res.status(422).json({ error: "Litros inválidos (debe ser un número entre 0 y 1.000.000)" });
  const day = b.day || new Date().toISOString().slice(0, 10);
  // Un registro por dia: si ya hay, reemplaza.
  db.prepare("DELETE FROM water_readings WHERE shed_id = ? AND day = ? AND source='manual'").run(shed.id, day);
  db.prepare("INSERT INTO water_readings (shed_id, day, liters, source, created_by) VALUES (?, ?, ?, 'manual', ?)").run(shed.id, day, liters, req.user.uid);
  res.json({ ok: true });
});

/* ---------- Sanidad / vacunacion ---------- */
router.get("/sites/:id/health", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const rows = db.prepare(`
    SELECT h.*, s.name AS shed_name, s.category FROM health_events h
    JOIN sheds s ON s.id = h.shed_id WHERE s.site_id = ?
    ORDER BY h.done, h.next_due IS NULL, h.next_due
  `).all(site.id);
  const events = rows.map((e) => {
    const st = HEALTH.eventStatus(e);
    return { e, st, alerts: HEALTH.alertsFor(e, st, e.shed_name) };
  });
  // Los avisos de sanidad vencida los dispara el job de fondo, no este GET.
  res.json({ events, rollup: HEALTH.rollup(events), suggested: HEALTH.SUGGESTED });
});

router.post("/sheds/:shedId/health", auth.requireAuth, (req, res) => {
  const shed = ownedShed(req.params.shedId, req.user.tid);
  if (!shed) return res.status(404).json({ error: "Galpón no encontrado" });
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: "Falta el título del evento sanitario" });
  const r = db.prepare(`
    INSERT INTO health_events (shed_id, title, kind, product, apply_date, next_due, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(shed.id, b.title, b.kind || "vacuna", b.product || null, b.apply_date || null, b.next_due || null, b.note || null, req.user.uid);
  res.json({ id: r.lastInsertRowid });
});

// Marcar aplicado: guarda fecha y, si se pasa intervalo, agenda la proxima.
router.post("/health/:id/done", auth.requireAuth, (req, res) => {
  const ev = db.prepare(`
    SELECT h.* FROM health_events h JOIN sheds s ON s.id = h.shed_id
    JOIN sites si ON si.id = s.site_id WHERE h.id = ? AND si.tenant_id = ?
  `).get(req.params.id, req.user.tid);
  if (!ev) return res.status(404).json({ error: "Evento no encontrado" });
  const today = new Date().toISOString().slice(0, 10);
  const b = req.body || {};
  let nextDue = null;
  if (b.everyDays && Number(b.everyDays) > 0) {
    const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + Number(b.everyDays));
    nextDue = d.toISOString().slice(0, 10);
  }
  // Si repite: queda como nuevo pendiente con next_due; si no, se marca hecho.
  db.prepare("UPDATE health_events SET apply_date = ?, done = ?, next_due = ? WHERE id = ?")
    .run(today, nextDue ? 0 : 1, nextDue, ev.id);
  res.json({ ok: true, next_due: nextDue });
});

/* ---------- Stock de alimento (kg) ---------- */
// Balance actual = suma de movimientos (ingresos + / egresos -).
function feedBalance(siteId) {
  const r = db.prepare("SELECT COALESCE(SUM(kg), 0) AS bal FROM feed_moves WHERE site_id = ?").get(siteId);
  return Math.round((r.bal || 0) * 10) / 10;
}

router.get("/sites/:id/feed", auth.requireAuth, (req, res) => {
  const site = db.prepare("SELECT id, feed_low_kg, feed_auto FROM sites WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const balance = feedBalance(site.id);
  const moves = db.prepare(`
    SELECT f.id, f.kg, f.kind, f.note, f.batch_id, f.created_at, b.name AS batch_name
    FROM feed_moves f LEFT JOIN batches b ON b.id = f.batch_id
    WHERE f.site_id = ? ORDER BY f.created_at DESC, f.id DESC LIMIT 40
  `).all(site.id);
  const lowKg = site.feed_low_kg;
  res.json({
    balance,
    low_kg: lowKg,
    auto: !!site.feed_auto,
    lowStock: lowKg != null && balance <= lowKg,
    moves,
  });
});

// Movimiento manual: ingreso (compra) o egreso (consumo/merma). kg siempre positivo.
router.post("/sites/:id/feed/move", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const b = req.body || {};
  const kg = Number(b.kg);
  if (!(kg > 0) || kg > 1e7) return res.status(422).json({ error: "Kg inválidos (número positivo)" });
  const kind = b.kind === "egreso" ? "egreso" : "ingreso";
  const signed = kind === "egreso" ? -kg : kg;
  if (kind === "egreso" && feedBalance(site.id) - kg < 0 && !b.force)
    return res.status(409).json({ error: "El egreso deja el stock en negativo. Revisá la cantidad o forzá el movimiento.", needsForce: true });
  const r = db.prepare("INSERT INTO feed_moves (site_id, kg, kind, note, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(site.id, signed, kind, (b.note || "").trim() || null, req.user.uid);
  res.json({ ok: true, id: r.lastInsertRowid, balance: feedBalance(site.id) });
});

// Configuracion del stock: umbral de aviso y modo de descuento automatico.
router.post("/sites/:id/feed/config", auth.requireAuth, auth.requireRole("owner"), (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const b = req.body || {};
  const lowKg = b.low_kg == null || b.low_kg === "" ? null : Number(b.low_kg);
  if (lowKg != null && (!(lowKg >= 0) || lowKg > 1e7)) return res.status(422).json({ error: "Umbral de stock bajo inválido" });
  const auto = b.auto ? 1 : 0;
  db.prepare("UPDATE sites SET feed_low_kg = ?, feed_auto = ? WHERE id = ?").run(lowKg, auto, site.id);
  res.json({ ok: true });
});

/* ---------- Stock de medicamentos ---------- */
function ownedMedItem(itemId, tenantId) {
  return db.prepare(`
    SELECT mi.* FROM med_items mi JOIN sites si ON si.id = mi.site_id
    WHERE mi.id = ? AND si.tenant_id = ?
  `).get(itemId, tenantId);
}
function medBalance(itemId) {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) AS bal FROM med_moves WHERE item_id = ?").get(itemId);
  return Math.round((r.bal || 0) * 10) / 10;
}

router.get("/sites/:id/meds", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const items = db.prepare("SELECT * FROM med_items WHERE site_id = ? ORDER BY name").all(site.id).map((it) => {
    const balance = medBalance(it.id);
    const moves = db.prepare("SELECT id, qty, kind, note, created_at FROM med_moves WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 10").all(it.id);
    return { ...it, balance, lowStock: it.low_qty != null && balance <= it.low_qty, moves };
  });
  res.json({ items });
});

router.post("/sites/:id/meds/item", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(422).json({ error: "Falta el nombre del producto" });
  const unit = ["dosis", "ml", "frascos", "unidades"].includes(b.unit) ? b.unit : "dosis";
  const lowQty = b.low_qty == null || b.low_qty === "" ? null : Number(b.low_qty);
  if (lowQty != null && !(lowQty >= 0)) return res.status(422).json({ error: "Umbral inválido" });
  const r = db.prepare("INSERT INTO med_items (site_id, name, unit, low_qty) VALUES (?, ?, ?, ?)")
    .run(site.id, String(b.name).trim(), unit, lowQty);
  res.json({ id: r.lastInsertRowid });
});

router.post("/meds/:itemId/move", auth.requireAuth, (req, res) => {
  const item = ownedMedItem(req.params.itemId, req.user.tid);
  if (!item) return res.status(404).json({ error: "Producto no encontrado" });
  const b = req.body || {};
  const qty = Number(b.qty);
  if (!(qty > 0)) return res.status(422).json({ error: "Cantidad inválida (número positivo)" });
  const kind = b.kind === "egreso" ? "egreso" : "ingreso";
  const signed = kind === "egreso" ? -qty : qty;
  if (kind === "egreso" && medBalance(item.id) - qty < 0 && !b.force)
    return res.status(409).json({ error: "El egreso deja el stock en negativo. Revisá la cantidad o forzá el movimiento.", needsForce: true });
  db.prepare("INSERT INTO med_moves (item_id, qty, kind, note, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(item.id, signed, kind, (b.note || "").trim() || null, req.user.uid);
  res.json({ ok: true, balance: medBalance(item.id) });
});

/* ---------- Movimientos de animales entre galpones ---------- */
router.get("/sites/:id/movements", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const moves = db.prepare(`
    SELECT m.*, sf.name AS from_name, st.name AS to_name
    FROM animal_moves m
    LEFT JOIN sheds sf ON sf.id = m.from_shed_id
    LEFT JOIN sheds st ON st.id = m.to_shed_id
    WHERE m.site_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 40
  `).all(site.id);
  res.json({ movements: moves });
});

router.post("/sites/:id/movements", auth.requireAuth, (req, res) => {
  const site = siteTenant(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  const b = req.body || {};
  const qty = parseInt(b.qty, 10);
  const reason = ["traslado", "venta", "baja"].includes(b.reason) ? b.reason : "traslado";
  if (!(qty > 0)) return res.status(422).json({ error: "Cantidad inválida (entero positivo)" });
  // El galpon de origen debe existir y pertenecer al criadero; para traslado, tambien el destino.
  const from = ownedShed(b.from_shed_id, req.user.tid);
  if (!from || from.site_id !== site.id) return res.status(404).json({ error: "Galpón de origen inválido" });
  if ((from.animals || 0) < qty) return res.status(409).json({ error: `El galpón de origen tiene ${from.animals || 0} animales; no alcanza para mover ${qty}` });
  let to = null;
  if (reason === "traslado") {
    to = ownedShed(b.to_shed_id, req.user.tid);
    if (!to || to.site_id !== site.id) return res.status(404).json({ error: "Galpón de destino inválido" });
    if (to.id === from.id) return res.status(422).json({ error: "El origen y el destino no pueden ser el mismo galpón" });
  }
  const tx = db.transaction(() => {
    db.prepare("UPDATE sheds SET animals = animals - ? WHERE id = ?").run(qty, from.id);
    if (to) db.prepare("UPDATE sheds SET animals = animals + ? WHERE id = ?").run(qty, to.id);
    db.prepare("INSERT INTO animal_moves (site_id, from_shed_id, to_shed_id, qty, reason, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(site.id, from.id, to ? to.id : null, qty, reason, (b.note || "").trim() || null, req.user.uid);
  });
  tx();
  res.json({ ok: true });
});

/* ---------- Alertas historicas ---------- */
router.get("/sites/:id/alerts", auth.requireAuth, (req, res) => {
  const site = db.prepare("SELECT id FROM sites WHERE id = ? AND tenant_id = ?").get(req.params.id, req.user.tid);
  if (!site) return res.status(404).json({ error: "No encontrado" });
  // Estado derivado: activa | resuelta (con quién y cuándo). Permite auditar el ciclo de vida.
  const rows = db.prepare(`
    SELECT id, shed_id, type, severity, title, message, actions_json,
           resolved, resolved_at, resolved_by, created_at,
           CASE WHEN resolved = 1 THEN 'resuelta' ELSE 'activa' END AS estado
    FROM alerts WHERE site_id = ? ORDER BY resolved, created_at DESC LIMIT 50
  `).all(site.id);
  res.json({ alerts: rows });
});

// Resolucion manual de una alerta (queda registrado quién y cuándo).
router.post("/alerts/:id/resolve", auth.requireAuth, (req, res) => {
  const al = db.prepare(`
    SELECT a.id FROM alerts a JOIN sites si ON si.id = a.site_id
    WHERE a.id = ? AND si.tenant_id = ?
  `).get(req.params.id, req.user.tid);
  if (!al) return res.status(404).json({ error: "Alerta no encontrada" });
  db.prepare("UPDATE alerts SET resolved = 1, resolved_at = datetime('now'), resolved_by = ? WHERE id = ?")
    .run(req.user.uid, al.id);
  res.json({ ok: true });
});

module.exports = router;
