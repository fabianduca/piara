/* Piara — autenticacion multi-tenant (JWT + bcrypt). */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

// El secreto JWT DEBE venir del entorno en produccion. Con el secreto de
// desarrollo hardcodeado, cualquiera puede forjar un token para cualquier
// criadero. En NODE_ENV=production sin PIARA_SECRET, el proceso no arranca.
const DEV_SECRET = "piara-dev-secret-cambiar-en-produccion";
const JWT_SECRET = process.env.PIARA_SECRET || DEV_SECRET;
if (process.env.NODE_ENV === "production" && JWT_SECRET === DEV_SECRET) {
  throw new Error("PIARA_SECRET no configurado: definí una clave secreta antes de correr en producción.");
}
const TOKEN_TTL = "30d";

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function checkPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

function signToken(user) {
  return jwt.sign({ uid: user.id, tid: user.tenant_id, email: user.email, role: user.role || "owner" }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// Middleware: exige usuario logueado; adjunta req.user = { uid, tid, email, role }.
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: "No autorizado" });
  // Tokens viejos no traen role: se completa desde la base (default 'owner').
  if (!payload.role) {
    const u = db.prepare("SELECT role FROM users WHERE id = ?").get(payload.uid);
    payload.role = (u && u.role) || "owner";
  }
  req.user = payload;
  next();
}

// Middleware: exige que el usuario tenga uno de los roles indicados.
// Roles: owner (dueño/admin), veterinario, operario.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autorizado" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "No tenés permiso para esta acción" });
    next();
  };
}

// Middleware: autentica un dispositivo por su api_key (header x-api-key).
function requireDevice(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ error: "Falta x-api-key" });
  const device = db.prepare("SELECT * FROM devices WHERE api_key = ?").get(key);
  if (!device) return res.status(401).json({ error: "Dispositivo no reconocido" });
  req.device = device;
  next();
}

function newApiKey() { return "pk_" + crypto.randomBytes(18).toString("hex"); }

module.exports = { hashPassword, checkPassword, signToken, verifyToken, requireAuth, requireRole, requireDevice, newApiKey };
