/* Piara — notificaciones (WhatsApp/SMS).
 *
 * Proveedor enchufable: si estan las variables de entorno de Twilio, envia de verdad;
 * si no, la notificacion queda en la bandeja de salida (status 'outbox') y se muestra
 * igual dentro de la app. Asi el producto funciona hoy sin credenciales y se "enciende"
 * el canal real con solo cargar el proveedor.
 *
 * Para activar WhatsApp real (Twilio):
 *   PIARA_TWILIO_SID   = ACxxxx
 *   PIARA_TWILIO_TOKEN = xxxx
 *   PIARA_TWILIO_FROM  = whatsapp:+14155238886   (numero/sandbox de Twilio)
 */
const db = require("./db");

const SID = process.env.PIARA_TWILIO_SID;
const TOKEN = process.env.PIARA_TWILIO_TOKEN;
const FROM = process.env.PIARA_TWILIO_FROM;
const providerReady = Boolean(SID && TOKEN && FROM);

function providerStatus() {
  return { channel: "whatsapp", provider: providerReady ? "twilio" : "ninguno (bandeja de salida)", ready: providerReady };
}

// Encola y trata de enviar. Devuelve el id de la notificacion.
async function enqueue({ tenantId, siteId, recipient, title, body }) {
  const ins = db.prepare(`
    INSERT INTO notifications (tenant_id, site_id, channel, recipient, title, body, status)
    VALUES (?, ?, 'whatsapp', ?, ?, ?, ?)
  `).run(tenantId, siteId || null, recipient || null, title, body || "", "outbox");
  const id = ins.lastInsertRowid;

  if (providerReady && recipient) {
    try {
      await sendWhatsAppTwilio(recipient, `${title}\n${body || ""}`.trim());
      db.prepare("UPDATE notifications SET status='sent' WHERE id=?").run(id);
    } catch (e) {
      db.prepare("UPDATE notifications SET status='failed', error=? WHERE id=?").run(String(e.message || e), id);
    }
  }
  return id;
}

async function sendWhatsAppTwilio(to, text) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const form = new URLSearchParams({ From: FROM, To: toAddr, Body: text });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("Twilio HTTP " + res.status + " " + (await res.text()).slice(0, 200));
  return res.json();
}

// Igual que enqueue pero evita duplicar el mismo titulo en las ultimas 12 h.
async function enqueueOnce(args) {
  const dup = db.prepare(
    "SELECT id FROM notifications WHERE tenant_id = ? AND title = ? AND created_at > datetime('now','-12 hours') LIMIT 1"
  ).get(args.tenantId, args.title);
  if (dup) return null;
  return enqueue(args);
}

function recent(tenantId, limit = 30) {
  return db.prepare(
    "SELECT id, site_id, channel, recipient, title, body, status, created_at FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(tenantId, limit);
}

module.exports = { enqueue, enqueueOnce, recent, providerStatus, providerReady };
