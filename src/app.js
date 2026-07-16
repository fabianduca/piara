/* Piara — frontend SPA. Auth + dashboard + sensores contra la API. */
(function () {
  "use strict";
  const ITH = window.PiaraITH;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const state = { token: null, criadero: null, sites: [], siteId: null, view: "dashboard", timer: null };

  /* ---------- API helper ---------- */
  async function api(path, { method = "GET", body, deviceKey } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    if (deviceKey) headers["x-api-key"] = deviceKey;
    const res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }

  /* ---------- Auth ---------- */
  function initAuth() {
    $$(".auth-tabs .tab").forEach((t) => t.addEventListener("click", () => {
      $$(".auth-tabs .tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const tab = t.dataset.tab;
      $("#loginForm").classList.toggle("hidden", tab !== "login");
      $("#registerForm").classList.toggle("hidden", tab !== "register");
    }));

    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const r = await api("/auth/login", { method: "POST", body: { email: f.email.value, password: f.password.value } });
        onAuth(r);
      } catch (err) { $("#loginErr").textContent = err.message; }
    });

    $("#registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const r = await api("/auth/register", { method: "POST", body: {
          criadero: f.criadero.value, email: f.email.value, password: f.password.value,
        }});
        onAuth(r);
      } catch (err) { $("#registerErr").textContent = err.message; }
    });
  }

  function onAuth(r) {
    state.token = r.token; state.criadero = r.criadero;
    localStorage.setItem("piara_token", r.token);
    localStorage.setItem("piara_criadero", r.criadero);
    enterApp();
  }

  function logout() {
    clearInterval(state.timer);
    localStorage.removeItem("piara_token");
    state.token = null;
    $("#appView").classList.add("hidden");
    $("#authView").classList.remove("hidden");
  }

  /* ---------- App ---------- */
  async function enterApp() {
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#tenantName").textContent = state.criadero || "";
    startClock();
    const { sites } = await api("/sites");
    state.sites = sites;
    const sel = $("#siteSelect");
    sel.innerHTML = sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    state.siteId = sites[0] && sites[0].id;

    // Los listeners se conectan una sola vez, aunque enterApp() vuelva a correr tras un re-login.
    if (!state.wired) {
      sel.addEventListener("change", () => {
        state.siteId = Number(sel.value);
        const dv = $("#dashboardView");
        dv.classList.add("is-swapping");
        Promise.resolve(refresh()).finally(() => dv.classList.remove("is-swapping"));
      });
      $("#logoutBtn").addEventListener("click", logout);
      $$(".navbtn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
      $("#deviceForm").addEventListener("submit", onCreateDevice);
      $("#whatsappForm").addEventListener("submit", onSaveWhatsapp);
      $("#testNotifBtn").addEventListener("click", onTestNotif);
      $("#batchForm").addEventListener("submit", onCreateBatch);
      $("#matingForm").addEventListener("submit", onCreateMating);
      $("#waterForm").addEventListener("submit", onSaveWater);
      $("#healthForm").addEventListener("submit", onCreateHealth);
      $("#feedForm").addEventListener("submit", onFeedMove);
      $("#feedConfigForm").addEventListener("submit", onFeedConfig);
      $("#thresholdsForm").addEventListener("submit", onSaveThresholds);
      $("#thrResetBtn").addEventListener("click", onResetThresholds);
      $("#medItemForm").addEventListener("submit", onCreateMedItem);
      $("#movementForm").addEventListener("submit", onCreateMovement);
      $("#moveReason").addEventListener("change", updateMoveToVisibility);
      $("#userForm").addEventListener("submit", onCreateUser);
      state.wired = true;
    }

    // Rol del usuario (para mostrar/ocultar la configuración de dueño).
    try { const acc = await api("/account"); state.role = acc.me && acc.me.role; state.uid = acc.me && acc.me.uid; } catch { state.role = "owner"; }
    applyRoleUI();

    if (!state.siteId) { $("#statusTitle").textContent = "No hay establecimientos cargados."; return; }
    refresh();
    state.timer = setInterval(refresh, 90 * 1000);
  }

  function switchView(view) {
    state.view = view;
    $$(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $("#dashboardView").classList.toggle("hidden", view !== "dashboard");
    $("#productionView").classList.toggle("hidden", view !== "production");
    $("#reproView").classList.toggle("hidden", view !== "repro");
    $("#waterView").classList.toggle("hidden", view !== "water");
    $("#feedView").classList.toggle("hidden", view !== "feed");
    $("#healthView").classList.toggle("hidden", view !== "health");
    $("#medsView").classList.toggle("hidden", view !== "meds");
    $("#movementsView").classList.toggle("hidden", view !== "movements");
    $("#benchmarkView").classList.toggle("hidden", view !== "benchmark");
    $("#sensorsView").classList.toggle("hidden", view !== "sensors");
    $("#notificationsView").classList.toggle("hidden", view !== "notifications");
    if (view === "sensors") loadDevices();
    if (view === "notifications") loadNotifications();
    if (view === "production") loadProduction();
    if (view === "repro") loadRepro();
    if (view === "water") loadWater();
    if (view === "feed") loadFeed();
    if (view === "health") loadHealth();
    if (view === "meds") loadMeds();
    if (view === "movements") loadMovements();
    if (view === "benchmark") loadBenchmark();
  }

  async function refresh() {
    if (!state.siteId) return;
    try {
      const d = await api(`/sites/${state.siteId}/dashboard`);
      renderDashboard(d);
    } catch (err) {
      $("#statusTitle").textContent = "No se pudo cargar el panel";
      $("#statusDesc").textContent = err.message;
    }
  }

  /* ---------- Render dashboard ---------- */
  function renderDashboard(d) {
    const cur = d.current || {};
    state.thresholds = d.thresholds || null; // umbrales del criadero (para colorear igual que el backend)
    const ithNow = cur.temp != null ? ITH.computeITH(cur.temp, cur.humidity) : null;
    const sev = ithNow != null ? ITH.severityFromITH(ithNow, state.thresholds) : { level: 0, label: "s/d", color: "#555" };

    // Hero
    $("#ithValue").textContent = ithNow != null ? ithNow : "--";
    const badge = $("#ithBadge");
    const pct = ithNow != null ? Math.min(100, Math.max(3, (ithNow - 60) / 30 * 100)) : 0;
    badge.style.setProperty("--gauge-pct", pct + "%");
    if (ithNow != null) badge.dataset.level = sev.level; else delete badge.dataset.level;
    $("#statusTitle").textContent = statusHeadline(d);
    $("#statusDesc").textContent = statusDesc(d, sev);
    $("#nowMetrics").innerHTML = `
      <div class="m"><b>${fmt(cur.temp)}°C</b><span>Temperatura</span></div>
      <div class="m"><b>${fmt(cur.humidity)}%</b><span>Humedad</span></div>
      <div class="m"><b>${fmt(cur.rainMm)} mm</b><span>Lluvia ahora</span></div>
      <div class="m"><b>${d.sheds.length}</b><span>Galpones</span></div>`;

    // Riesgos
    setRisk("#riskHeat", maxAlertSeverity(d.alerts, ["heat", "heat-forecast"]));
    setRisk("#riskRain", maxAlertSeverity(d.alerts, ["rain"]));
    setRisk("#riskCold", maxAlertSeverity(d.alerts, ["cold"]));

    renderAlerts(d.alerts);
    renderChart(d.ithForecast);
    renderFeeding(d.feeding);
    renderSheds(d.sheds);
    renderEcon(d.economics);
    renderSoil(d.soil);
    $("#clockUpdated") && ($("#clockUpdated").textContent = "");
  }

  function statusHeadline(d) {
    const lvl = Math.max(d.worstShedLevel || 0, ...(d.alerts || []).map((a) => a.severity), 0);
    return ["Todo en confort térmico", "Atención: estrés térmico ligero",
      "Peligro: estrés térmico moderado", "Emergencia térmica"][lvl];
  }
  function statusDesc(d, sev) {
    if (!d.alerts.length) return "Sin alertas activas. El clima está dentro de la zona de confort de los animales.";
    const next = d.alerts[0];
    return `${d.alerts.length} alerta(s) activa(s). Prioridad: ${next.title}`;
  }

  function setRisk(sel, level) {
    const el = $(sel);
    const labels = ["Bajo", "Ligero", "Moderado", "Alto"];
    el.textContent = labels[level] || "Bajo";
    el.className = "sev-" + level;
  }
  function maxAlertSeverity(alerts, types) {
    return (alerts || []).filter((a) => types.includes(a.type)).reduce((m, a) => Math.max(m, a.severity), 0);
  }

  function renderAlerts(alerts) {
    const box = $("#alerts");
    $("#alertCount").textContent = alerts.length ? `${alerts.length} activa(s)` : "";
    const html = !alerts.length
      ? `<div class="no-alerts">Sin alertas. Clima dentro de zona de confort.</div>`
      : alerts.map((a) => `
      <div class="alert s${a.severity}">
        <div class="a-title">${esc(a.title)}</div>
        <div class="a-msg">${esc(a.message || "")}</div>
        <ul>${(a.actions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>`).join("");
    // Solo re-renderiza si cambió: evita re-disparar la animación de entrada en cada refresh (90 s).
    if (box.__lastHtml === html) return;
    box.__lastHtml = html;
    box.innerHTML = html;
  }

  function renderChart(forecast) {
    const box = $("#ithChart");
    if (!forecast || !forecast.length) { box.innerHTML = `<span class="muted small">Sin pronóstico disponible.</span>`; return; }
    const max = 92, min = 55;
    box.innerHTML = forecast.map((f) => {
      const sev = ITH.severityFromITH(f.ith, state.thresholds);
      const h = Math.min(100, Math.max(8, (f.ith - min) / (max - min) * 100));
      const dt = new Date(f.ts);
      const cls = ["ok", "warn", "danger", "emergency"][sev.level];
      return `<div class="bar ${cls}" style="height:${h}%" title="${dt.toLocaleString("es-AR")} · ITH ${f.ith} · ${f.temp}°C"></div>`;
    }).join("");
  }

  function renderFeeding(feeding) {
    const box = $("#feedTimeline");
    if (!feeding || !feeding.length) { box.innerHTML = `<span class="muted small">Sin datos.</span>`; return; }
    box.innerHTML = feeding.map((f) => {
      const cls = f.rec + (f.prime ? " prime" : "");
      return `<div class="feed-h ${cls}" title="ITH ${f.ith}"><b>${String(f.hour).padStart(2, "0")}h</b>${f.temp}°</div>`;
    }).join("");
    const evitar = feeding.filter((f) => f.rec === "evitar").map((f) => f.hour);
    const advice = $("#feedAdvice");
    if (evitar.length) {
      advice.innerHTML = `Evitá alimentar entre las <b>${Math.min(...evitar)}h y ${Math.max(...evitar)}h</b> (calor). Cargá la ración temprano a la mañana y al atardecer.`;
    } else {
      advice.innerHTML = `Día fresco: podés alimentar en el horario habitual sin penalidad térmica.`;
    }
  }

  function renderSheds(sheds) {
    const box = $("#sheds");
    box.innerHTML = sheds.map((s) => {
      const sev = s.severity;
      const cat = (ITH.CATEGORIES[s.category] || {}).label || s.category;
      const src = s.source === "sensor"
        ? `<div class="src sensor">Sensor: ${esc(s.sensor?.name || "")} (en vivo)</div>`
        : `<div class="src clima">Estimado por clima exterior</div>`;
      const flags = (s.flags || []).map((f) =>
        `<div class="f f-sev${f.severity}">${esc(f.title)}</div>`).join("");
      const sh = s.stressHours48 || 0;
      const shTxt = sh > 0
        ? `<div class="stress-h">${sh} h de estrés térmico pronosticadas (48 h)</div>` : "";
      return `<div class="shed">
        <div class="shed-top"><div><b>${esc(s.name)}</b><div class="cat">${esc(cat)} · ${s.animals} anim.</div></div>
          <span class="sev-${sev.level} pill">${sev.label}</span></div>
        <div class="big-ith">${s.ith}</div>
        <div class="metrics"><span>${fmt(s.temp)} °C</span><span>${fmt(s.humidity)} % hum.</span></div>
        ${src}
        ${shTxt}
        <div class="flags">${flags}</div>
      </div>`;
    }).join("");
  }

  function renderEcon(e) {
    if (!e) return;
    $("#econ").innerHTML = `
      <div class="card"><b>USD ${e.usdDia}</b><span>Pérdida evitable hoy</span></div>
      <div class="card"><b>USD ${e.usdMesProyectado}</b><span>Proyección mensual si no se actúa</span></div>
      <div class="card"><b>${e.animalesEnRiesgo}</b><span>Animales expuestos a estrés</span></div>
      ${e.detalle.length ? `<div class="econ-detail">Detalle: ${e.detalle.map((d) =>
        `${esc(d.shedName)} (${d.kgPerdidos} kg / USD ${d.usd})`).join(" · ")}</div>` : ""}`;
  }

  function renderSoil(soil) {
    const box = $("#soilPanel");
    if (!box) return;
    if (!soil || soil.moisture == null) { box.innerHTML = `<span class="muted small">Sin dato de humedad de suelo.</span>`; return; }
    const pct = Math.round((soil.moisture / 0.5) * 100);
    const color = ["var(--ok)", "var(--warn)", "var(--danger)", "var(--emergency)"][soil.level];
    box.innerHTML = `
      <div class="soil-top">
        <div><b class="soil-val">${Math.round(soil.moisture * 100)}%</b><div class="muted small">humedad de suelo (0-9 cm)</div></div>
        <span class="sev-${soil.level} pill">${soil.label}</span>
      </div>
      <div class="soil-bar"><div class="soil-fill" style="width:${Math.min(100, pct)}%;background:${color}"></div></div>
      <div class="muted small soil-detail">${esc(soil.detail)}</div>`;
  }

  /* ---------- Producción / rendimiento ---------- */
  async function loadProduction() {
    try {
      const { sheds } = await api(`/sites/${state.siteId}/sheds`);
      $("#batchShed").innerHTML = sheds
        .filter((s) => s.category === "engorde" || s.category === "recria")
        .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
      if (!$("#batchDate").value) $("#batchDate").value = new Date().toISOString().slice(0, 10);

      const { batches, rollup } = await api(`/sites/${state.siteId}/production`);
      $("#prodRollup").innerHTML = `
        <div class="card"><b>${rollup.lotes}</b><span>Lotes activos</span></div>
        <div class="card"><b>${rollup.animals}</b><span>Animales en engorde</span></div>
        <div class="card"><b>${rollup.adgProm ?? "--"}</b><span>ADG promedio (kg/día)</span></div>
        <div class="card"><b>${rollup.fcrProm ?? "--"}</b><span>Índice conversión prom.</span></div>
        <div class="card"><b>USD ${rollup.lossUsd}</b><span>Pérdida vs. objetivo</span></div>`;
      renderBatches(batches);
    } catch (err) { $("#batchList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }

  function renderBatches(batches) {
    const box = $("#batchList");
    if (!batches.length) { box.innerHTML = `<span class="muted small">No hay lotes cargados. Creá uno arriba para empezar a medir el rendimiento.</span>`; return; }
    box.innerHTML = batches.map(({ batch: b, metrics: m, alerts }) => {
      const closed = b.status === "closed";
      const fcrCls = m.fcr == null ? "" : (m.fcr >= m.fcrObjetivo + 0.8 ? "kpi-bad" : m.fcr > m.fcrObjetivo ? "kpi-warn" : "kpi-good");
      const adgCls = !m.hasWeigh ? "" : (m.adg < m.adgObjetivo * 0.85 ? "kpi-bad" : m.adg >= m.adgObjetivo ? "kpi-good" : "kpi-warn");
      const alertHtml = alerts.map((a) => `<div class="b-alert lvl${a.level}"><b>${esc(a.kpi)}:</b> ${esc(a.text)}</div>`).join("");
      return `<div class="batch ${closed ? "closed" : ""}">
        <div class="batch-head">
          <div><b>${esc(b.name)}</b> <span class="muted small">· ${esc(b.shed_name)} · desde ${esc(b.start_date)} (${m.days} días)</span></div>
          ${closed ? `<span class="tag-closed">cerrado</span>` : `<button class="btn ghost tiny" data-close="${b.id}">Cerrar lote</button>`}
        </div>
        <div class="kpis">
          <div class="kpi"><span>Peso actual</span><b>${m.weightNow} kg${m.hasWeigh ? "" : " *"}</b></div>
          <div class="kpi ${adgCls}"><span>Ganancia diaria</span><b>${m.adg} kg/d</b></div>
          <div class="kpi ${fcrCls}"><span>Índice conversión</span><b>${m.fcr ?? "--"}</b></div>
          <div class="kpi"><span>Mortandad</span><b>${m.mortalityPct}%</b></div>
          <div class="kpi"><span>${m.readyToSlaughter ? "Faena" : "Faena en"}</span><b>${m.readyToSlaughter ? "¡lista!" : m.projDays + " días"}</b></div>
          <div class="kpi ${m.lossUsdTotal > 0 ? "kpi-bad" : ""}"><span>Pérdida vs obj.</span><b>USD ${m.lossUsdTotal}</b></div>
        </div>
        ${alertHtml}
        ${closed ? "" : `<form class="batch-update" data-id="${b.id}">
          <input type="number" step="0.1" name="current_weight_kg" placeholder="última pesada (kg)" />
          <input type="number" step="1" name="feed_kg" placeholder="alimento total (kg): ${b.feed_kg}" />
          <input type="number" step="1" name="deaths" placeholder="bajas: ${b.deaths}" />
          <button class="btn primary tiny" type="submit">Actualizar</button>
        </form>`}
        ${m.hasWeigh ? "" : `<div class="muted small">* peso estimado con el objetivo; cargá una pesada para métricas reales.</div>`}
      </div>`;
    }).join("");

    box.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", async () => {
      await api(`/batches/${btn.dataset.close}/close`, { method: "POST" }); loadProduction();
    }));
    box.querySelectorAll(".batch-update").forEach((form) => form.addEventListener("submit", onUpdateBatch));
  }

  async function onCreateBatch(e) {
    e.preventDefault();
    const body = {
      name: $("#batchName").value, start_date: $("#batchDate").value,
      animals_in: Number($("#batchAnimals").value), weight_in_kg: Number($("#batchWin").value),
      target_weight_kg: Number($("#batchWtarget").value) || 110,
    };
    const shedId = $("#batchShed").value;
    if (!shedId) { alert("Necesitás un galpón de engorde/recría. Cargá uno primero."); return; }
    try {
      await api(`/sheds/${shedId}/batches`, { method: "POST", body });
      $("#batchName").value = ""; $("#batchAnimals").value = ""; $("#batchWin").value = "";
      loadProduction();
    } catch (err) { alert(err.message); }
  }

  async function onUpdateBatch(e) {
    e.preventDefault();
    const f = e.target;
    const body = {};
    if (f.current_weight_kg.value) body.current_weight_kg = Number(f.current_weight_kg.value);
    if (f.feed_kg.value) body.feed_kg = Number(f.feed_kg.value);
    if (f.deaths.value) body.deaths = Number(f.deaths.value);
    try { await api(`/batches/${f.dataset.id}/update`, { method: "POST", body }); loadProduction(); }
    catch (err) { alert(err.message); }
  }

  /* ---------- Reproducción ---------- */
  async function loadRepro() {
    try {
      const { sheds } = await api(`/sites/${state.siteId}/sheds`);
      $("#matingShed").innerHTML = sheds.filter((s) => s.category === "cerda")
        .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")
        || sheds.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
      if (!$("#matingDate").value) $("#matingDate").value = new Date().toISOString().slice(0, 10);

      const { matings, rollup } = await api(`/sites/${state.siteId}/repro`);
      $("#reproRollup").innerHTML = `
        <div class="card"><b>${rollup.gestando}</b><span>Cerdas gestando</span></div>
        <div class="card"><b>${rollup.partosNext7}</b><span>Partos en 7 días</span></div>
        <div class="card"><b>${rollup.partosNext30}</b><span>Partos en 30 días</span></div>
        <div class="card"><b>${rollup.lactando}</b><span>En lactancia</span></div>
        <div class="card"><b>${rollup.nacidosVivosProm ?? "--"}</b><span>Nacidos vivos prom.</span></div>`;
      renderMatings(matings);
    } catch (err) { $("#matingList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }

  function renderMatings(list) {
    const box = $("#matingList");
    if (!list.length) { box.innerHTML = `<span class="muted small">Sin servicios cargados. Registrá uno arriba para armar el calendario de partos.</span>`; return; }
    box.innerHTML = list.map(({ m, mt, alerts }) => {
      const badge = mt.status === "gestando"
        ? (mt.overdue ? `<span class="sev-3 pill">atrasada</span>` : `<span class="sev-${mt.daysToFarrow <= 3 ? 2 : mt.daysToFarrow <= 7 ? 1 : 0} pill">pare en ${mt.daysToFarrow} d</span>`)
        : mt.status === "parida" ? `<span class="sev-1 pill">lactancia día ${mt.lactDay}</span>`
        : `<span class="pill pill-neutral">destetada</span>`;
      const alertHtml = alerts.map((a) => `<div class="b-alert lvl${a.level}">${esc(a.text)}</div>`).join("");
      const detail = mt.status === "gestando"
        ? `Servicio ${esc(m.service_date)} → parto estimado <b>${esc(mt.expectedFarrow)}</b> · trimestre ${mt.trimester}`
        : mt.status === "parida"
        ? `Parió ${esc(mt.farrowDate)} · ${m.born_alive ?? "?"} vivos · destete estimado ${esc(mt.expectedWean)}`
        : `${m.born_alive ?? "?"} nacidos vivos · ${m.weaned ?? "?"} destetados`;
      const actions = mt.status === "gestando"
        ? `<form class="repro-farrow" data-id="${m.id}">
             <input type="date" name="farrow_date" value="${esc(mt.expectedFarrow)}" />
             <input type="number" name="born_alive" placeholder="nacidos vivos" style="max-width:120px" />
             <button class="btn primary tiny" type="submit">Registrar parto</button></form>`
        : mt.status === "parida"
        ? `<form class="repro-wean" data-id="${m.id}">
             <input type="number" name="weaned" placeholder="destetados" style="max-width:120px" />
             <button class="btn primary tiny" type="submit">Registrar destete</button></form>`
        : "";
      return `<div class="mating">
        <div class="batch-head"><div><b>Cerda ${esc(m.sow_label)}</b> <span class="muted small">· ${esc(m.shed_name)}</span></div>${badge}</div>
        <div class="muted small" style="margin:4px 0">${detail}</div>
        ${alertHtml}${actions}
      </div>`;
    }).join("");
    box.querySelectorAll(".repro-farrow").forEach((f) => f.addEventListener("submit", onFarrow));
    box.querySelectorAll(".repro-wean").forEach((f) => f.addEventListener("submit", onWean));
  }

  async function onCreateMating(e) {
    e.preventDefault();
    const shedId = $("#matingShed").value;
    if (!shedId) { alert("Necesitás un galpón (idealmente de categoría cerda)."); return; }
    try {
      await api(`/sheds/${shedId}/matings`, { method: "POST", body: { sow_label: $("#matingSow").value, service_date: $("#matingDate").value } });
      $("#matingSow").value = ""; loadRepro();
    } catch (err) { alert(err.message); }
  }
  async function onFarrow(e) {
    e.preventDefault(); const f = e.target;
    try { await api(`/matings/${f.dataset.id}/farrow`, { method: "POST", body: { farrow_date: f.farrow_date.value, born_alive: f.born_alive.value ? Number(f.born_alive.value) : null } }); loadRepro(); }
    catch (err) { alert(err.message); }
  }
  async function onWean(e) {
    e.preventDefault(); const f = e.target;
    try { await api(`/matings/${f.dataset.id}/wean`, { method: "POST", body: { weaned: f.weaned.value ? Number(f.weaned.value) : null } }); loadRepro(); }
    catch (err) { alert(err.message); }
  }

  /* ---------- Agua ---------- */
  async function loadWater() {
    try {
      const { sheds } = await api(`/sites/${state.siteId}/sheds`);
      $("#waterShed").innerHTML = sheds.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
      if (!$("#waterDay").value) $("#waterDay").value = new Date().toISOString().slice(0, 10);

      const { sheds: rows } = await api(`/sites/${state.siteId}/water`);
      const box = $("#waterList");
      box.innerHTML = rows.map(({ shed, analysis }) => {
        const lvl = analysis.level || 0;
        const latest = analysis.latest ? `${analysis.latest.liters} L (${esc(analysis.latest.day)})` : "sin registro";
        return `<div class="water-card">
          <div class="batch-head"><div><b>${esc(shed.name)}</b> <span class="muted small">· ${shed.animals} anim.</span></div>
            <span class="sev-${lvl} pill">${["OK","Atención","Alerta"][lvl] || "OK"}</span></div>
          <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
            <div class="kpi"><span>Último</span><b>${esc(latest)}</b></div>
            <div class="kpi"><span>Promedio</span><b>${analysis.baseline ?? "--"} L</b></div>
            <div class="kpi"><span>Esperado</span><b>${analysis.expected ?? "--"} L</b></div>
          </div>
          <div class="muted small" style="margin-top:8px">${esc(analysis.message || "Cargá varios días para detectar caídas.")}</div>
        </div>`;
      }).join("");
    } catch (err) { $("#waterList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }

  async function onSaveWater(e) {
    e.preventDefault();
    const shedId = $("#waterShed").value;
    try {
      await api(`/sheds/${shedId}/water`, { method: "POST", body: { liters: Number($("#waterLiters").value), day: $("#waterDay").value } });
      $("#waterLiters").value = ""; loadWater();
    } catch (err) { alert(err.message); }
  }

  /* ---------- Alimento / stock ---------- */
  async function loadFeed() {
    try {
      const f = await api(`/sites/${state.siteId}/feed`);
      const low = f.low_kg != null;
      $("#feedRollup").innerHTML = `
        <div class="card ${f.lowStock ? "kpi-bad" : ""}"><b>${fmt(f.balance)} kg</b><span>Stock actual${f.lowStock ? " · ¡bajo!" : ""}</span></div>
        <div class="card"><b>${low ? f.low_kg + " kg" : "--"}</b><span>Umbral de aviso</span></div>
        <div class="card"><b>${f.auto ? "Automático" : "Manual"}</b><span>Modo de descuento</span></div>`;
      $("#feedLowKg").value = low ? f.low_kg : "";
      $("#feedAuto").checked = !!f.auto;
      const box = $("#feedMoves");
      box.innerHTML = f.moves.length ? f.moves.map((m) => {
        const inc = m.kg >= 0;
        return `<div class="notif">
          <div class="notif-head"><b>${inc ? "＋" : "－"} ${Math.abs(m.kg)} kg <span class="muted small">(${esc(kindLabel(m.kind))})</span></b>
            <span class="muted small">${new Date(m.created_at + "Z").toLocaleString("es-AR")}</span></div>
          <div class="muted small notif-body">${esc(m.note || (m.batch_name ? "Lote " + m.batch_name : ""))}</div>
        </div>`;
      }).join("") : `<span class="muted small">Sin movimientos. Registrá el primer ingreso de alimento arriba.</span>`;
    } catch (err) { $("#feedMoves").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }
  function kindLabel(k) { return { ingreso: "ingreso", egreso: "egreso", auto: "auto (lote)" }[k] || k; }

  async function onFeedMove(e) {
    e.preventDefault();
    const kg = Number($("#feedKg").value);
    if (!(kg > 0)) { alert("Ingresá una cantidad de kilos válida."); return; }
    const body = { kg, kind: $("#feedKind").value, note: $("#feedNote").value };
    try {
      await api(`/sites/${state.siteId}/feed/move`, { method: "POST", body });
      $("#feedKg").value = ""; $("#feedNote").value = ""; loadFeed();
    } catch (err) {
      if (/negativo/i.test(err.message) && confirm(err.message + "\n\n¿Registrar igual?")) {
        try { await api(`/sites/${state.siteId}/feed/move`, { method: "POST", body: { ...body, force: true } }); $("#feedKg").value = ""; $("#feedNote").value = ""; loadFeed(); }
        catch (e2) { alert(e2.message); }
      } else if (!/negativo/i.test(err.message)) alert(err.message);
    }
  }

  async function onFeedConfig(e) {
    e.preventDefault();
    const body = { low_kg: $("#feedLowKg").value === "" ? null : Number($("#feedLowKg").value), auto: $("#feedAuto").checked };
    try { await api(`/sites/${state.siteId}/feed/config`, { method: "POST", body }); loadFeed(); }
    catch (err) { alert(err.message); }
  }

  /* ---------- Medicamentos ---------- */
  async function loadMeds() {
    try {
      const { items } = await api(`/sites/${state.siteId}/meds`);
      const box = $("#medList");
      box.innerHTML = items.length ? items.map((it) => {
        const movesTxt = it.moves.map((m) => `${m.qty >= 0 ? "＋" : "－"}${Math.abs(m.qty)} ${esc(it.unit)}`).join(" · ");
        return `<div class="water-card">
          <div class="batch-head"><div><b>${esc(it.name)}</b> <span class="muted small">· ${esc(it.unit)}</span></div>
            <span class="sev-${it.lowStock ? 2 : 0} pill">${it.lowStock ? "stock bajo" : "ok"}</span></div>
          <div class="kpis" style="grid-template-columns:repeat(2,1fr)">
            <div class="kpi"><span>Stock</span><b>${fmt(it.balance)} ${esc(it.unit)}</b></div>
            <div class="kpi"><span>Avisar bajo</span><b>${it.low_qty != null ? it.low_qty : "--"}</b></div>
          </div>
          <form class="med-move inline-form" data-id="${it.id}" style="margin-top:8px">
            <select name="kind"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select>
            <input name="qty" type="number" step="1" placeholder="cantidad" style="max-width:110px" />
            <input name="note" placeholder="nota (opcional)" />
            <button class="btn primary tiny" type="submit">Registrar</button>
          </form>
          ${it.moves.length ? `<div class="muted small" style="margin-top:6px">Últimos: ${esc(movesTxt)}</div>` : ""}
        </div>`;
      }).join("") : `<span class="muted small">Sin productos. Agregá el primero arriba (ej: una vacuna del plan sanitario).</span>`;
      box.querySelectorAll(".med-move").forEach((f) => f.addEventListener("submit", onMedMove));
    } catch (err) { $("#medList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }
  async function onCreateMedItem(e) {
    e.preventDefault();
    const body = { name: $("#medName").value, unit: $("#medUnit").value, low_qty: $("#medLow").value === "" ? null : Number($("#medLow").value) };
    if (!body.name.trim()) { alert("Poné el nombre del producto."); return; }
    try { await api(`/sites/${state.siteId}/meds/item`, { method: "POST", body }); $("#medName").value = ""; $("#medLow").value = ""; loadMeds(); }
    catch (err) { alert(err.message); }
  }
  async function onMedMove(e) {
    e.preventDefault();
    const f = e.target;
    const qty = Number(f.qty.value);
    if (!(qty > 0)) { alert("Cantidad inválida."); return; }
    const body = { qty, kind: f.kind.value, note: f.note.value };
    try { await api(`/meds/${f.dataset.id}/move`, { method: "POST", body }); loadMeds(); }
    catch (err) {
      if (/negativo/i.test(err.message) && confirm(err.message + "\n\n¿Registrar igual?")) {
        try { await api(`/meds/${f.dataset.id}/move`, { method: "POST", body: { ...body, force: true } }); loadMeds(); } catch (e2) { alert(e2.message); }
      } else if (!/negativo/i.test(err.message)) alert(err.message);
    }
  }

  /* ---------- Movimientos de animales ---------- */
  async function loadMovements() {
    try {
      const { sheds } = await api(`/sites/${state.siteId}/sheds`);
      const opts = sheds.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.animals} anim.)</option>`).join("");
      $("#moveFrom").innerHTML = opts;
      $("#moveTo").innerHTML = opts;
      updateMoveToVisibility();
      const { movements } = await api(`/sites/${state.siteId}/movements`);
      const box = $("#movementList");
      box.innerHTML = movements.length ? movements.map((m) => {
        const dest = m.reason === "traslado" ? `→ ${esc(m.to_name || "?")}` : `(${esc(m.reason)})`;
        return `<div class="notif">
          <div class="notif-head"><b>${m.qty} anim. · ${esc(m.from_name || "?")} ${dest}</b>
            <span class="muted small">${new Date(m.created_at + "Z").toLocaleString("es-AR")}</span></div>
          ${m.note ? `<div class="muted small notif-body">${esc(m.note)}</div>` : ""}
        </div>`;
      }).join("") : `<span class="muted small">Sin movimientos registrados.</span>`;
    } catch (err) { $("#movementList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }
  function updateMoveToVisibility() {
    const isTraslado = $("#moveReason").value === "traslado";
    $("#moveTo").style.display = isTraslado ? "" : "none";
  }
  async function onCreateMovement(e) {
    e.preventDefault();
    const reason = $("#moveReason").value;
    const body = { reason, from_shed_id: $("#moveFrom").value, qty: Number($("#moveQty").value), note: $("#moveNote").value };
    if (reason === "traslado") body.to_shed_id = $("#moveTo").value;
    if (!(body.qty > 0)) { alert("Cantidad inválida."); return; }
    try { await api(`/sites/${state.siteId}/movements`, { method: "POST", body }); $("#moveQty").value = ""; $("#moveNote").value = ""; loadMovements(); }
    catch (err) { alert(err.message); }
  }

  /* ---------- Equipo / usuarios (solo owner) ---------- */
  function applyRoleUI() {
    const isOwner = state.role === "owner";
    $$(".owner-only").forEach((el) => el.classList.toggle("hidden", !isOwner));
  }
  async function loadTeam() {
    if (state.role !== "owner") return;
    try {
      const { users } = await api("/users");
      const box = $("#userList");
      box.innerHTML = users.map((u) => `<div class="notif">
        <div class="notif-head"><b>${esc(u.email)}</b>
          <span class="muted small">
            <select data-role-for="${u.id}" ${u.id === state.uid ? "disabled" : ""}>
              ${["owner", "veterinario", "operario"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
            ${u.id === state.uid ? "" : `<button class="btn ghost tiny" data-del-user="${u.id}">Eliminar</button>`}
          </span></div></div>`).join("");
      box.querySelectorAll("[data-role-for]").forEach((sel) => sel.addEventListener("change", () => onChangeRole(sel.dataset.roleFor, sel.value)));
      box.querySelectorAll("[data-del-user]").forEach((btn) => btn.addEventListener("click", () => onDeleteUser(btn.dataset.delUser)));
    } catch (err) { $("#userList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }
  async function onCreateUser(e) {
    e.preventDefault();
    const body = { email: $("#userEmail").value, password: $("#userPass").value, role: $("#userRole").value };
    try { await api("/users", { method: "POST", body }); $("#userEmail").value = ""; $("#userPass").value = ""; loadTeam(); }
    catch (err) { alert(err.message); }
  }
  async function onChangeRole(id, role) {
    try { await api(`/users/${id}/role`, { method: "POST", body: { role } }); loadTeam(); }
    catch (err) { alert(err.message); loadTeam(); }
  }
  async function onDeleteUser(id) {
    if (!confirm("¿Eliminar este usuario?")) return;
    try { await api(`/users/${id}`, { method: "DELETE" }); loadTeam(); }
    catch (err) { alert(err.message); }
  }

  /* ---------- Sanidad ---------- */
  async function loadHealth() {
    try {
      const { sheds } = await api(`/sites/${state.siteId}/sheds`);
      $("#healthShed").innerHTML = sheds.map((s) => `<option value="${s.id}" data-cat="${s.category}">${esc(s.name)}</option>`).join("");
      if (!$("#healthDue").value) $("#healthDue").value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const { events, rollup, suggested } = await api(`/sites/${state.siteId}/health`);
      state.healthSuggested = suggested;
      updateHealthSuggest();
      $("#healthShed").onchange = updateHealthSuggest;
      $("#healthRollup").innerHTML = `
        <div class="card"><b>${rollup.total}</b><span>Eventos</span></div>
        <div class="card"><b style="color:var(--emergency-text)">${rollup.vencidos}</b><span>Vencidos</span></div>
        <div class="card"><b style="color:var(--warn-text)">${rollup.proximos}</b><span>Vencen en 7 días</span></div>
        <div class="card"><b style="color:var(--ok-text)">${rollup.alDia}</b><span>Al día</span></div>`;
      renderHealth(events);
    } catch (err) { $("#healthList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }

  function updateHealthSuggest() {
    const opt = $("#healthShed").selectedOptions[0];
    const cat = opt && opt.dataset.cat;
    const list = (state.healthSuggested && state.healthSuggested[cat]) || [];
    $("#healthSuggest").textContent = list.length ? "Sugerido: " + list.map((x) => x.title).join(" · ") : "";
  }

  function renderHealth(events) {
    const box = $("#healthList");
    if (!events.length) { box.innerHTML = `<span class="muted small">Sin eventos. Agendá vacunas y tratamientos para no saltearlos.</span>`; return; }
    const stateLabel = { vencido: "sev-3", proximo: "sev-1", "al-dia": "sev-0", hecho: "", "sin-fecha": "" };
    box.innerHTML = events.map(({ e, st }) => {
      const pill = st.state === "hecho" ? `<span class="pill pill-neutral">hecho</span>`
        : `<span class="${stateLabel[st.state] || ""} pill">${st.state === "vencido" ? "vencido " + Math.abs(st.daysToDue) + "d" : st.state === "proximo" ? "en " + st.daysToDue + "d" : st.state === "al-dia" ? "en " + st.daysToDue + "d" : "sin fecha"}</span>`;
      const done = e.done ? "" : `<button class="btn primary tiny" data-done="${e.id}">Marcar aplicado</button>`;
      return `<div class="mating">
        <div class="batch-head"><div><b>${esc(e.title)}</b> <span class="muted small">· ${esc(e.shed_name)} · ${esc(e.kind)}${e.product ? " · " + esc(e.product) : ""}</span></div>${pill}</div>
        <div class="muted small" style="margin:4px 0">${e.next_due ? "Próxima: " + esc(e.next_due) : "Sin fecha agendada"}${e.apply_date ? " · última: " + esc(e.apply_date) : ""}</div>
        ${done}
      </div>`;
    }).join("");
    box.querySelectorAll("[data-done]").forEach((btn) => btn.addEventListener("click", async () => {
      await api(`/health/${btn.dataset.done}/done`, { method: "POST", body: {} }); loadHealth();
    }));
  }

  async function onCreateHealth(e) {
    e.preventDefault();
    const shedId = $("#healthShed").value;
    try {
      await api(`/sheds/${shedId}/health`, { method: "POST", body: {
        title: $("#healthTitle").value, kind: $("#healthKind").value,
        product: $("#healthProduct").value, next_due: $("#healthDue").value,
      }});
      $("#healthTitle").value = ""; $("#healthProduct").value = ""; loadHealth();
    } catch (err) { alert(err.message); }
  }

  /* ---------- Comparar / benchmark ---------- */
  async function loadBenchmark() {
    try {
      const [dash, prod] = await Promise.all([
        api(`/sites/${state.siteId}/dashboard`),
        api(`/sites/${state.siteId}/production`),
      ]);
      const batchByShed = {};
      prod.batches.filter((b) => b.batch.status === "active").forEach((b) => { batchByShed[b.batch.shed_id] = b; });

      const rows = dash.sheds.map((s) => {
        const b = batchByShed[s.id];
        return {
          name: s.name, cat: (window.PiaraITH.CATEGORIES[s.category] || {}).label || s.category,
          ith: s.ith, sev: s.severity.level, stress: s.stressHours48 || 0,
          adg: b ? b.metrics.adg : null, fcr: b ? b.metrics.fcr : null,
          mort: b ? b.metrics.mortalityPct : null, loss: b ? b.metrics.lossUsdTotal : null,
          hasBatch: !!b,
        };
      });
      // Ranking: peor primero por pérdida y estrés.
      rows.sort((a, b) => (b.loss || 0) - (a.loss || 0) || b.stress - a.stress);

      const cell = (v, good) => v == null ? '<td class="muted">-</td>' : `<td class="${good}">${v}</td>`;
      const adgCls = (v) => v == null ? "" : v >= 0.85 ? "gc" : v >= 0.72 ? "wc" : "bc";
      const fcrCls = (v) => v == null ? "" : v <= 2.8 ? "gc" : v <= 3.4 ? "wc" : "bc";
      const mortCls = (v) => v == null ? "" : v < 4 ? "gc" : v < 7 ? "wc" : "bc";
      $("#benchTable").innerHTML = `
        <thead><tr><th>Galpón</th><th>Categoría</th><th>ITH</th><th>Horas estrés 48h</th><th>Gan. diaria</th><th>Conversión</th><th>Mortandad</th><th>Pérdida USD</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td><b>${esc(r.name)}</b></td>
          <td class="muted">${esc(r.cat)}</td>
          <td class="sev-txt-${r.sev}">${r.ith}</td>
          <td class="${r.stress > 0 ? "bc" : ""}">${r.stress}</td>
          ${cell(r.adg != null ? r.adg + " kg" : null, adgCls(r.adg))}
          ${cell(r.fcr, fcrCls(r.fcr))}
          ${cell(r.mort != null ? r.mort + "%" : null, mortCls(r.mort))}
          ${cell(r.loss != null ? "USD " + r.loss : null, r.loss > 0 ? "bc" : "gc")}
        </tr>`).join("")}</tbody>`;
    } catch (err) { $("#benchTable").innerHTML = `<tbody><tr><td class="auth-err">${esc(err.message)}</td></tr></tbody>`; }
  }

  /* ---------- Avisos / WhatsApp ---------- */
  async function loadNotifications() {
    try {
      const acc = await api("/account");
      $("#whatsappNumber").value = acc.settings.whatsapp || "";
      $("#minSeverity").value = String(acc.settings.notify_min_severity || 2);
      $("#notifierStatus").textContent = acc.notifier.ready ? "WhatsApp activo (Twilio)" : "Sin proveedor: los avisos quedan en el historial";
      if (acc.thresholds) {
        const t = acc.thresholds;
        $("#thrComfort").value = t.comfort; $("#thrAlert").value = t.alert; $("#thrEmergency").value = t.emergency;
        $("#thrDefaults").textContent = `Default: confort ${t.defaults.comfort} · peligro ${t.defaults.alert} · emergencia ${t.defaults.emergency}`;
      }
      if (acc.me) { state.role = acc.me.role; state.uid = acc.me.uid; applyRoleUI(); }
      loadTeam();

      const { notifications } = await api("/notifications");
      const box = $("#notifList");
      box.innerHTML = notifications.length ? notifications.map((n) => `
        <div class="notif s-${n.status}">
          <div class="notif-head">
            <b>${esc(n.title)}</b><span class="muted small">${new Date(n.created_at + "Z").toLocaleString("es-AR")}</span></div>
          <div class="muted small notif-body">${esc(n.body || "")}</div>
          <div class="notif-meta">${n.recipient ? "→ " + esc(n.recipient) : "sin número"} · ${statusLabel(n.status)}</div>
        </div>`).join("") : `<span class="muted small">Todavía no se generaron avisos. Cuando salte una alerta severa aparecen acá (y al WhatsApp si está configurado).</span>`;
    } catch (err) { $("#notifList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }

  function statusLabel(s) { return { outbox: "en bandeja", sent: "enviado", failed: "falló" }[s] || s; }

  async function onSaveWhatsapp(e) {
    e.preventDefault();
    try {
      await api("/account/whatsapp", { method: "POST", body: { whatsapp: $("#whatsappNumber").value, minSeverity: $("#minSeverity").value } });
      $("#notifierStatus").textContent = "Guardado ✅";
      loadNotifications();
    } catch (err) { alert(err.message); }
  }

  async function onSaveThresholds(e) {
    e.preventDefault();
    const body = { comfort: Number($("#thrComfort").value), alert: Number($("#thrAlert").value), emergency: Number($("#thrEmergency").value) };
    try {
      await api("/account/thresholds", { method: "POST", body });
      alert("Umbrales guardados. Se aplican en el próximo refresco del panel.");
      if (state.siteId) refresh();
    } catch (err) { alert(err.message); }
  }
  async function onResetThresholds() {
    if (!confirm("¿Volver a los umbrales estándar porcinos?")) return;
    try { await api("/account/thresholds", { method: "POST", body: { reset: true } }); loadNotifications(); if (state.siteId) refresh(); }
    catch (err) { alert(err.message); }
  }

  async function onTestNotif() {
    try {
      const r = await api("/notifications/test", { method: "POST" });
      alert(r.sent ? "Aviso de prueba enviado al WhatsApp." : "Sin proveedor configurado: el aviso quedó en el historial (así lo verá el productor en la app).");
      loadNotifications();
    } catch (err) { alert(err.message); }
  }

  /* ---------- Sensores ---------- */
  async function loadDevices() {
    try {
      const { devices } = await api(`/sites/${state.siteId}/devices`);
      const box = $("#deviceList");
      box.innerHTML = devices.length ? devices.map((d) => {
        const online = d.last_seen && (Date.now() - new Date(d.last_seen + "Z").getTime()) < 30 * 60000;
        return `<div class="device">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b>${esc(d.name)}</b><span class="status ${online ? "online" : "offline"}">${online ? "online" : "offline"}</span></div>
          <div class="muted small" style="margin-top:6px">Galpón: ${esc(d.shed_name)}</div>
          <div class="muted small">Última señal: ${d.last_seen ? new Date(d.last_seen + "Z").toLocaleString("es-AR") : "nunca"}</div>
          <div class="muted small" style="margin-top:6px">API key:<br><code>${esc(d.api_key)}</code></div>
        </div>`;
      }).join("") : `<span class="muted small">No hay sensores. Dá de alta uno abajo, o probá el simulador.</span>`;

      const shedSel = $("#deviceShed");
      const { sheds } = await api(`/sites/${state.siteId}/sheds`);
      shedSel.innerHTML = sheds.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    } catch (err) { $("#deviceList").innerHTML = `<span class="auth-err">${esc(err.message)}</span>`; }
  }

  async function onCreateDevice(e) {
    e.preventDefault();
    const shedId = $("#deviceShed").value;
    const name = $("#deviceName").value || "Sensor";
    try {
      const r = await api(`/sheds/${shedId}/devices`, { method: "POST", body: { name } });
      const box = $("#deviceCreated");
      box.classList.remove("hidden");
      box.innerHTML = `Sensor creado. Guardá esta API key (no se vuelve a mostrar completa):<br>
        <code>${r.api_key}</code><br><br>
        El dispositivo postea así:<br>
        <code>POST /api/ingest</code> con header <code>x-api-key: ${r.api_key}</code><br>
        body <code>{ "temp": 27.4, "humidity": 68 }</code>`;
      $("#deviceName").value = "";
      loadDevices();
    } catch (err) { alert(err.message); }
  }

  /* ---------- Utils ---------- */
  function startClock() {
    const tick = () => { $("#clock").textContent = new Date().toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }); };
    tick();
    if (!state.clockTimer) state.clockTimer = setInterval(tick, 30000);
  }
  function fmt(v) { return v == null || isNaN(v) ? "--" : v; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* ---------- Boot ---------- */
  function boot() {
    initAuth();
    const token = localStorage.getItem("piara_token");
    const criadero = localStorage.getItem("piara_criadero");
    if (token) { state.token = token; state.criadero = criadero; enterApp().catch(() => logout()); }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
