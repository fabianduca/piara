/* Piara — ingesta de clima via Open-Meteo (gratis, sin API key).
 * Trae temperatura, humedad relativa y lluvia horaria (48h) por establecimiento. */
const db = require("./db");

// Node 18+ trae fetch global.
async function fetchForecast(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,precipitation,soil_moisture_3_to_9cm");
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("timezone", "America/Argentina/Buenos_Aires");

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("Open-Meteo HTTP " + res.status);
  const data = await res.json();

  const h = data.hourly || {};
  const times = h.time || [];
  // Open-Meteo devuelve las horas en la zona del establecimiento (param timezone),
  // pero SIN offset ("2026-07-16T14:00"). Si el server corre en UTC, `new Date(ts)`
  // las interpreta mal (desfase de 3 h). Le pegamos el offset real que informa la API
  // para que el instante sea absoluto y el "hora local" siga leyendose del string.
  const offset = fmtOffset(data.utc_offset_seconds);
  const stamp = (ts) => (offset && !/[Z+]|-\d{2}:\d{2}$/.test(ts) ? ts + offset : ts);
  const nowMs = Date.now();
  const hourly = [];
  for (let i = 0; i < times.length; i++) {
    const ts = stamp(times[i]);
    if (new Date(ts).getTime() < nowMs - 3.6e6) continue; // desde la hora actual
    hourly.push({
      ts,
      temp: num(h.temperature_2m?.[i]),
      humidity: num(h.relative_humidity_2m?.[i]),
      rainMm: num(h.precipitation?.[i]),
      soil: num3(h.soil_moisture_3_to_9cm?.[i]), // m3/m3 (0..~0.5), saturado cerca de 0.4+
    });
    if (hourly.length >= 48) break;
  }

  const cur = data.current || {};
  const current = {
    temp: num(cur.temperature_2m ?? hourly[0]?.temp),
    humidity: num(cur.relative_humidity_2m ?? hourly[0]?.humidity),
    rainMm: num(cur.precipitation ?? 0),
  };
  return { current, hourly };
}

// Persiste un snapshot de clima para un site.
function saveSnapshot(siteId, current, hourly) {
  db.prepare(
    `INSERT INTO weather_snapshots (site_id, temp, humidity, rain_mm, forecast_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(siteId, current.temp, current.humidity, current.rainMm, JSON.stringify(hourly));
}

// Devuelve el ultimo snapshot guardado de un site (o null).
function latestSnapshot(siteId) {
  const row = db.prepare(
    "SELECT * FROM weather_snapshots WHERE site_id = ? ORDER BY ts DESC LIMIT 1"
  ).get(siteId);
  if (!row) return null;
  return {
    ts: row.ts,
    current: { temp: row.temp, humidity: row.humidity, rainMm: row.rain_mm },
    hourly: JSON.parse(row.forecast_json || "[]"),
  };
}

// Refresca el clima de un site desde Open-Meteo y lo guarda. Devuelve {current, hourly}.
async function refreshSite(site) {
  const { current, hourly } = await fetchForecast(site.lat, site.lon);
  saveSnapshot(site.id, current, hourly);
  return { current, hourly };
}

// Segundos de offset UTC (-10800) -> string ISO ("-03:00").
function fmtOffset(sec) {
  if (sec == null || isNaN(sec)) return null;
  const s = sec < 0 ? "-" : "+";
  const a = Math.abs(sec);
  const hh = String(Math.floor(a / 3600)).padStart(2, "0");
  const mm = String(Math.floor((a % 3600) / 60)).padStart(2, "0");
  return `${s}${hh}:${mm}`;
}

function num(v) { return v == null || isNaN(v) ? null : Math.round(Number(v) * 10) / 10; }
function num3(v) { return v == null || isNaN(v) ? null : Math.round(Number(v) * 1000) / 1000; }

module.exports = { fetchForecast, refreshSite, latestSnapshot, saveSnapshot };
