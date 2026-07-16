/* Piara — capa de datos usando el SQLite nativo de Node (node:sqlite, >=22).
 * Cero dependencias nativas / cero compilacion en Windows.
 * Se expone una API minima compatible con better-sqlite3 (.prepare, .exec, .transaction). */
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.PIARA_DB || path.join(__dirname, "..", "..", "piara.db");
const raw = new DatabaseSync(DB_PATH);
raw.exec("PRAGMA journal_mode = WAL;");
raw.exec("PRAGMA foreign_keys = ON;");

// Wrapper compatible: agrega .transaction() (node:sqlite no lo trae).
const db = {
  _raw: raw,
  prepare: (sql) => raw.prepare(sql),
  exec: (sql) => raw.exec(sql),
  transaction(fn) {
    return (...args) => {
      raw.exec("BEGIN");
      try { const r = fn(...args); raw.exec("COMMIT"); return r; }
      catch (e) { raw.exec("ROLLBACK"); throw e; }
    };
  },
};

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'pro',
      sub_status TEXT NOT NULL DEFAULT 'trial',   -- trial | active | past_due
      sub_price_usd REAL NOT NULL DEFAULT 200,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sheds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,          -- lechon | recria | engorde | cerda
      animals INTEGER NOT NULL DEFAULT 0,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shed_id INTEGER NOT NULL REFERENCES sheds(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'temp_humidity',
      last_seen TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      temp REAL,
      humidity REAL,
      extra TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON sensor_readings(device_id, ts);

    CREATE TABLE IF NOT EXISTS weather_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      temp REAL, humidity REAL, rain_mm REAL,
      forecast_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_weather_site_ts ON weather_snapshots(site_id, ts);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      shed_id INTEGER REFERENCES sheds(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      severity INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      actions_json TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Configuracion de avisos por criadero (telefono WhatsApp, severidad minima).
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      whatsapp TEXT,
      notify_min_severity INTEGER NOT NULL DEFAULT 2
    );

    -- Bandeja de salida de notificaciones (WhatsApp/SMS). Si no hay proveedor
    -- configurado, quedan en estado 'outbox' y se muestran igual en la app.
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      recipient TEXT,
      title TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'outbox',  -- outbox | sent | failed
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notif_tenant ON notifications(tenant_id, created_at);

    -- Lotes de produccion (engorde/recria): base de los KPIs de rendimiento.
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shed_id INTEGER NOT NULL REFERENCES sheds(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,             -- YYYY-MM-DD
      animals_in INTEGER NOT NULL,
      weight_in_kg REAL NOT NULL,           -- peso promedio de entrada
      target_weight_kg REAL NOT NULL DEFAULT 110,
      feed_kg REAL NOT NULL DEFAULT 0,      -- alimento acumulado entregado al lote
      deaths INTEGER NOT NULL DEFAULT 0,
      current_weight_kg REAL,               -- ultima pesada (opcional)
      current_weight_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',-- active | closed
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_batches_shed ON batches(shed_id, status);

    -- Servicios reproductivos (cerdas): base del calendario de partos.
    CREATE TABLE IF NOT EXISTS matings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shed_id INTEGER NOT NULL REFERENCES sheds(id) ON DELETE CASCADE,
      sow_label TEXT NOT NULL,               -- caravana/identificacion de la cerda
      service_date TEXT NOT NULL,            -- YYYY-MM-DD
      status TEXT NOT NULL DEFAULT 'gestando', -- gestando | parida | destetada | vacia
      farrow_date TEXT,                      -- parto real
      born_alive INTEGER,
      born_dead INTEGER,
      wean_date TEXT,
      weaned INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_matings_shed ON matings(shed_id, status);

    -- Registro de consumo de agua por galpon (manual o por sensor de caudal).
    CREATE TABLE IF NOT EXISTS water_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shed_id INTEGER NOT NULL REFERENCES sheds(id) ON DELETE CASCADE,
      day TEXT NOT NULL,                     -- YYYY-MM-DD
      liters REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual', -- manual | sensor
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_water_shed_day ON water_readings(shed_id, day);

    -- Registro sanitario / plan de vacunacion por galpon.
    CREATE TABLE IF NOT EXISTS health_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shed_id INTEGER NOT NULL REFERENCES sheds(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'vacuna',   -- vacuna | tratamiento | desparasitacion | revision
      product TEXT,
      apply_date TEXT,                       -- ultima aplicacion (YYYY-MM-DD)
      next_due TEXT,                         -- proxima fecha prevista
      done INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_health_shed ON health_events(shed_id, next_due);
  `);

  // Migracion: ciclo de vida de alertas (columnas agregadas despues del esquema inicial).
  addColumnIfMissing("alerts", "resolved_at", "TEXT");
  addColumnIfMissing("alerts", "resolved_by", "INTEGER");

  // Migracion: trazabilidad de autoria — quien cargo cada evento (auditoria).
  for (const t of ["batches", "matings", "water_readings", "health_events"]) {
    addColumnIfMissing(t, "created_by", "INTEGER");
  }

  // Migracion: umbrales ITH configurables por criadero (NULL = usa el default global).
  for (const c of ["ith_comfort", "ith_alert", "ith_emergency"]) {
    addColumnIfMissing("tenant_settings", c, "REAL");
  }

  // Migracion: stock de alimento (kg) por establecimiento.
  addColumnIfMissing("sites", "feed_low_kg", "REAL");      // umbral de aviso por stock bajo
  addColumnIfMissing("sites", "feed_auto", "INTEGER");     // 1 = descontar auto desde feed_kg de lotes
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      kg REAL NOT NULL,                        -- con signo: + ingreso, - egreso
      kind TEXT NOT NULL DEFAULT 'ingreso',    -- ingreso | egreso | auto
      note TEXT,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,  -- si viene de un lote (auto)
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feed_moves_site ON feed_moves(site_id, created_at);

    -- Stock de medicamentos: cada producto es un item con su unidad (dosis/ml/frascos).
    CREATE TABLE IF NOT EXISTS med_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'dosis',      -- dosis | ml | frascos | unidades
      low_qty REAL,                            -- umbral de aviso por stock bajo
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS med_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES med_items(id) ON DELETE CASCADE,
      qty REAL NOT NULL,                       -- con signo: + ingreso, - egreso
      kind TEXT NOT NULL DEFAULT 'ingreso',    -- ingreso | egreso
      note TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_med_moves_item ON med_moves(item_id, created_at);

    -- Movimientos de animales entre galpones (o salida por venta/baja).
    CREATE TABLE IF NOT EXISTS animal_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      from_shed_id INTEGER REFERENCES sheds(id) ON DELETE SET NULL,
      to_shed_id INTEGER REFERENCES sheds(id) ON DELETE SET NULL,  -- NULL = salida (venta/baja)
      qty INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT 'traslado', -- traslado | venta | baja
      note TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_animal_moves_site ON animal_moves(site_id, created_at);
  `);
}

// ALTER TABLE idempotente: agrega la columna solo si no existe (SQLite no tiene IF NOT EXISTS para columnas).
function addColumnIfMissing(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

init();
module.exports = db;
