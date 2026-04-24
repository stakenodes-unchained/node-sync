let token = localStorage.getItem("auth_token");
let availableChains = [];
let currentChainId = null;
let filteredChains = [];
let currentFilter = "all";
let searchQuery = "";
let editingNodeId = null;
let authContext = null;
let authMode = "login";

function nodeAvatarClass(index) { return `av-${(index % 5) + 1}`; }
function chainPillClass(symbol) { return ({ ETH: "cp-blue", BNB: "cp-amber", MATIC: "cp-purple", AVAX: "cp-red", SOL: "cp-teal" }[symbol]) || "cp-blue"; }
function statusPillClass(status) { return status === "Healthy" ? "sp-ok" : status === "Degrading" ? "sp-warn" : status === "Out of Sync" ? "sp-err" : "sp-off"; }
function delayChipClass(delay) { const n = parseInt(delay); return !delay || Number.isNaN(n) || n <= 3 ? "dc-ok" : n <= 10 ? "dc-warn" : "dc-err"; }

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    token = null;
    authContext = null;
    renderAuth();
    throw new Error("Please login first.");
  }
  return res;
}

function updateHeaderUser() {
  let holder = document.getElementById("authArea");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "authArea";
    holder.style.display = "flex";
    holder.style.gap = "8px";
    const navRight = document.querySelector(".nav-right");
    if (navRight) navRight.prepend(holder);
  }
  holder.innerHTML = "";

  if (!authContext) {
    const btn = document.createElement("button");
    btn.className = "btn-csv";
    btn.textContent = "Login";
    btn.onclick = () => switchTab("packages");
    holder.appendChild(btn);
    return;
  }

  const label = document.createElement("span");
  label.className = "mono-sm";
  label.textContent = `${authContext.user.email} (${authContext.subscription.plan})`;
  label.style.padding = "6px 8px";
  const logout = document.createElement("button");
  logout.className = "btn-csv";
  logout.textContent = "Logout";
  logout.onclick = async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    localStorage.removeItem("auth_token");
    token = null;
    authContext = null;
    renderAuth();
  };
  holder.appendChild(label);
  holder.appendChild(logout);
}

function renderAuth() {
  updateHeaderUser();
  const landing = document.getElementById("authLandingMessage");
  const authFormsWrap = document.getElementById("authFormsWrap");
  const profileContent = document.getElementById("profileContent");
  if (landing) {
    if (authContext) {
      landing.textContent = "Welcome back. Manage your account, monthly membership, and retention status.";
    } else if (token) {
      landing.textContent = "Welcome back.";
    } else {
      landing.textContent = "Start monitoring your nodes.";
    }
  }

  if (authFormsWrap) {
    authFormsWrap.style.display = authContext ? "none" : "flex";
  }
  if (profileContent) {
    profileContent.style.display = authContext ? "block" : "none";
  }

  const gates = ["dashboard", "addNode", "chains"];
  gates.forEach((tabId) => {
    const tab = document.getElementById(tabId);
    if (!tab) return;
    if (!authContext) {
      tab.style.opacity = "0.35";
      tab.style.pointerEvents = "none";
    } else {
      tab.style.opacity = "1";
      tab.style.pointerEvents = "auto";
    }
  });
}

async function fetchMe() {
  if (!token) {
    renderAuth();
    return;
  }
  try {
    const res = await apiFetch("/auth/me");
    authContext = await res.json();
  } catch (_error) {
    authContext = null;
  }
  renderAuth();
}

async function fetchStatus() {
  if (!authContext) return;
  const res = await apiFetch("/status");
  const data = await res.json();
  data.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const tbody = document.querySelector("#statusTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const total = data.length;
  const healthy = data.filter((n) => n.status === "Healthy").length;
  const warnings = data.filter((n) => n.status === "Degrading").length;
  const errors = data.filter((n) => n.status === "Out of Sync" || n.status === "Offline").length;
  if (document.getElementById("statTotal")) document.getElementById("statTotal").textContent = total;
  if (document.getElementById("statHealthy")) document.getElementById("statHealthy").textContent = healthy;
  if (document.getElementById("statWarning")) document.getElementById("statWarning").textContent = warnings;
  if (document.getElementById("statError")) document.getElementById("statError").textContent = errors;
  if (document.getElementById("panelSubtitle")) document.getElementById("panelSubtitle").textContent = `${total} node${total !== 1 ? "s" : ""} monitored`;

  data.forEach((node, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><div class="node-cell"><div class="node-av ${nodeAvatarClass(index)}">${(node.name || "??").substring(0, 2).toUpperCase()}</div><div><div class="node-nm">${node.name}</div><div class="node-id">#${node.id}</div></div></div></td>
      <td><span class="chain-pill ${chainPillClass(node.chain_symbol || "")}"><span class="cdot"></span>${node.chain_name || "Unknown"} (${node.chain_symbol || "?"})</span></td>
      <td><span class="status-pill ${statusPillClass(node.status)}"><span class="sdot"></span>${node.status}</span></td>
      <td class="mono">${node.localHeight ?? "—"}</td>
      <td class="mono">${node.remoteHeight ?? "—"}</td>
      <td><span class="delay-chip ${delayChipClass(node.delay)}">${node.delay ?? "—"}</span></td>
      <td class="mono">${Number(node.errorCount || 0)}</td>
      <td class="mono-sm">${node.lastChecked ? new Date(node.lastChecked).toLocaleString() : "—"}</td>
      <td class="err-text" style="color:var(--red);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${node.error ?? ""}</td>
      <td><div class="act-wrap"><button class="btn-ed" onclick="openNodeDetails(${node.id}, '${(node.name || "").replace(/'/g, "\\'")}')">View Details</button><button class="btn-ed" onclick="editNode(${node.id})">Edit</button><button class="btn-dl" onclick="deleteNode(${node.id})">Delete</button></div></td>`;
    tbody.appendChild(row);
  });
}

function updateChainsLastSyncLabel(isoDateString = null) {
  const label = document.getElementById("chainsLastSync");
  if (!label) return;

  if (!isoDateString) {
    label.textContent = "Last sync: Never";
    return;
  }

  const parsed = new Date(isoDateString);
  if (Number.isNaN(parsed.getTime())) {
    label.textContent = "Last sync: Never";
    return;
  }

  label.textContent = `Last sync: ${parsed.toLocaleString()}`;
}

// 📡 Fetch available chains
async function fetchChains() {
  if (!authContext) return;
  try {
    const res = await apiFetch("/chains");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    availableChains = await res.json();
    populateChainDropdown();
    // Also keep edit modal dropdown in sync if present
    if (typeof populateEditChainDropdown === "function") {
      populateEditChainDropdown();
    }
    displayChains(); // Also display chains in the chains tab
  } catch (error) {
    alert("Failed to load chains: " + error.message);
  }
}

// 🔄 Populate chain dropdown
function populateChainDropdown() {
  const chainSelect = document.getElementById("chainSelect");
  if (!chainSelect) return;

  chainSelect.innerHTML = '<option value="">Select a chain...</option>';

  availableChains.forEach((chain) => {
    const option = document.createElement("option");
    option.value = chain.id;
    option.textContent = `${chain.name} (${chain.symbol})`;
    option.dataset.chain = JSON.stringify(chain);
    chainSelect.appendChild(option);
  });
}

// 🔄 Handle chain selection
function onChainSelect() {
  const chainSelect = document.getElementById("chainSelect");
  if (!chainSelect) return;

  const selectedOption = chainSelect.options[chainSelect.selectedIndex];
  if (!selectedOption || !selectedOption.value) {
    clearChainDefaults();
    return;
  }

  const chain = JSON.parse(selectedOption.dataset.chain);
  populateChainDefaults(chain);
}

// Show/hide custom URL input when "Enter custom URL..." is selected in a remote URL select.
function onRemoteSelectChange(selectEl, customInputId) {
  const customInput = document.getElementById(customInputId);
  if (!customInput) return;
  if (selectEl.value === "__custom__") {
    customInput.style.display = "block";
    customInput.focus();
  } else {
    customInput.style.display = "none";
  }
}

// Return the effective remote URL value from a select + optional custom input pair.
function getRemoteUrlValue(selectId, customInputId) {
  const select = document.getElementById(selectId);
  if (!select) return "";
  if (select.value === "__custom__") {
    const customInput = document.getElementById(customInputId);
    return customInput ? customInput.value.trim() : "";
  }
  return select.value;
}

// Populate a remote URL <select> with chain rpc_urls and handle custom URL state.
// selectId: the <select> element id
// rpcUrls: array (or JSON string) of URLs from the chain
// selectedUrl: the currently saved URL to pre-select
// customInputId: the id of the paired custom text input
function populateRemoteDropdown(selectId, rpcUrls, selectedUrl = "", customInputId = null) {
  const select = document.getElementById(selectId);
  if (!select) return;

  let urls = [];
  if (Array.isArray(rpcUrls)) {
    urls = rpcUrls.filter(u => u && typeof u === "string");
  } else if (typeof rpcUrls === "string") {
    try {
      const parsed = JSON.parse(rpcUrls);
      urls = Array.isArray(parsed) ? parsed.filter(u => u && typeof u === "string") : [];
    } catch { urls = []; }
  }

  const customInput = customInputId ? document.getElementById(customInputId) : null;

  if (urls.length === 0) {
    select.innerHTML = '<option value="" disabled selected>Select a chain first...</option>';
    select.disabled = true;
    if (customInput) { customInput.style.display = "none"; customInput.value = ""; }
    return;
  }

  select.disabled = false;
  select.innerHTML = "";
  urls.forEach(url => {
    const opt = document.createElement("option");
    opt.value = url;
    opt.textContent = url;
    select.appendChild(opt);
  });

  const customOpt = document.createElement("option");
  customOpt.value = "__custom__";
  customOpt.textContent = "✎ Enter custom URL...";
  select.appendChild(customOpt);

  if (selectedUrl && urls.includes(selectedUrl)) {
    select.value = selectedUrl;
    if (customInput) customInput.style.display = "none";
  } else if (selectedUrl) {
    select.value = "__custom__";
    if (customInput) { customInput.style.display = "block"; customInput.value = selectedUrl; }
  } else {
    select.value = urls[0];
    if (customInput) customInput.style.display = "none";
  }
}

// 📝 Populate form with chain defaults
function populateChainDefaults(chain) {
  document.getElementById("rpcMethod").value = chain.rpc_method || "";
  document.getElementById("params").value = chain.default_params || "[]";
  document.getElementById("responsePath").value = chain.response_path || "result";
  document.getElementById("httpMethod").value = chain.http_method || "POST";
  populateRemoteDropdown("remote", chain.rpc_urls || [], "", "remoteCustom");
}

// 🧹 Clear chain defaults
function clearChainDefaults() {
  document.getElementById("rpcMethod").value = "";
  document.getElementById("params").value = "[]";
  document.getElementById("responsePath").value = "result";
  document.getElementById("httpMethod").value = "POST";
  populateRemoteDropdown("remote", [], "", "remoteCustom");
}

// ➕ Handle Add Node form
document.getElementById("nodeForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const chainId = document.getElementById("chainSelect").value;
  if (!chainId) {
    alert("❌ Please select a chain");
    return;
  }

  const remoteUrl = getRemoteUrlValue("remote", "remoteCustom");
  if (!remoteUrl) {
    alert("❌ Please select or enter a Remote URL");
    return;
  }

  const node = {
    name: document.getElementById("name").value.trim(),
    chain_id: parseInt(chainId),
    local_url: document.getElementById("local").value.trim(),
    remote_url: remoteUrl,
    custom_method: document.getElementById("rpcMethod").value.trim() || null,
    custom_params: document.getElementById("params").value.trim() || "[]",
    custom_headers: document.getElementById("headers").value.trim() || "{}",
    custom_response_path:
      document.getElementById("responsePath").value.trim() || null,
    custom_http_method: document.getElementById("httpMethod").value || null,
    check_interval: parseInt(document.getElementById("checkInterval").value) || 60,
  };

  const res = await apiFetch("/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(node),
  });

  if (res.ok) {
    e.target.reset();
    currentNodeId = null;
    clearChainDefaults();
    switchTab("dashboard");
    await fetchStatus(); // ✅ Live reload
  } else {
    const err = await res.json();
    alert("Failed to add node: " + (err.error || "Unknown error"));
  }
});

// ❌ Delete node
async function deleteNode(id) {
  if (!confirm(`Delete this node?`)) return;

  const res = await apiFetch(`/delete/${id}`, {
    method: "DELETE",
  });

  if (res.ok) {
    await fetchStatus(); // ✅ Live reload
  } else {
    alert("Failed to delete node.");
  }
}

// ✏️ Edit node (open and populate modal)
async function editNode(id) {
  try {
    const res = await apiFetch(`/nodes/${id}`);
    if (!res.ok) {
      return alert("Failed to fetch node data.");
    }
    const node = await res.json();

    // Set editing id
    editingNodeId = id;

    // Ensure chains are loaded
    if (availableChains.length === 0) {
      await fetchChains();
    }

    // Populate edit modal dropdown and fields
    populateEditChainDropdown();
    document.getElementById("editName").value = node.name || "";
    document.getElementById("editChainSelect").value = node.chain_id || "";
    onEditChainSelect();
    document.getElementById("editLocal").value = node.local_url || "";

    // Populate remote URL dropdown; ensures saved URL is selectable even if not in chain list
    const chainSelect = document.getElementById("editChainSelect");
    const chainOption = chainSelect.options[chainSelect.selectedIndex];
    const chainRpcUrls = chainOption && chainOption.dataset.chain
      ? JSON.parse(chainOption.dataset.chain).rpc_urls || []
      : [];
    populateEditRemoteDropdown(chainRpcUrls, node.remote_url || "");
    document.getElementById("editRpcMethod").value = node.custom_method || "";
    document.getElementById("editParams").value = node.custom_params || "[]";
    document.getElementById("editHeaders").value = node.custom_headers || "{}";
    document.getElementById("editResponsePath").value =
      node.custom_response_path || "result";
    document.getElementById("editHttpMethod").value =
      node.custom_http_method || "POST";
    document.getElementById("editCheckInterval").value =
      node.check_interval || 60;

    showEditNodeModal();
  } catch (error) {
    alert("Failed to load node data: " + error.message);
  }
}

// ===== Edit Node Modal helpers =====
function showEditNodeModal() {
  const modal = document.getElementById("editNodeModal");
  if (modal) modal.style.display = "flex";
}

function hideEditNodeModal() {
  const modal = document.getElementById("editNodeModal");
  if (modal) modal.style.display = "none";
  editingNodeId = null;
}

let currentHistoryNodeId = null;
let currentHistoryPage = 1;
let currentHistoryLimit = 25;
let currentHistoryPagination = { page: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false, total: 0 };

function showNodeHistoryModal() {
  const modal = document.getElementById("nodeHistoryModal");
  if (modal) modal.style.display = "flex";
}

function hideNodeHistoryModal() {
  const modal = document.getElementById("nodeHistoryModal");
  if (modal) modal.style.display = "none";
  currentHistoryNodeId = null;
  currentHistoryPage = 1;
}

function getHistoryRangeSelection() {
  const preset = document.getElementById("historyRangePreset")?.value || "1h";
  const from = document.getElementById("historyFrom")?.value;
  const to = document.getElementById("historyTo")?.value;
  return { preset, from, to };
}

function updateHistoryRangeUI() {
  const preset = document.getElementById("historyRangePreset")?.value || "1h";
  const wrap = document.getElementById("historyCustomRangeWrap");
  if (wrap) {
    wrap.style.display = preset === "custom" ? "flex" : "none";
  }
}

function calcUptimePercent(items, hours) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const scoped = items.filter((it) => new Date(it.checked_at).getTime() >= cutoff);
  if (scoped.length === 0) return 0;
  const upCount = scoped.filter((it) => it.status === "Healthy" || it.status === "Degrading").length;
  return (upCount / scoped.length) * 100;
}

function renderHistoryChart(items) {
  const svg = document.getElementById("historyChart");
  if (!svg) return;
  const width = 900;
  const height = 220;
  const padding = { top: 28, right: 18, bottom: 26, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const points = [...items].reverse().map((item, idx) => ({
    x: items.length <= 1 ? padding.left : padding.left + (idx / (items.length - 1)) * chartWidth,
    y: Number.isFinite(item.local_response_ms) ? item.local_response_ms : null
  })).filter((p) => p.y !== null);

  const maxY = Math.max(...points.map((p) => p.y), 100);
  const minY = Math.min(...points.map((p) => p.y), maxY);
  const avgY = points.length ? (points.reduce((sum, p) => sum + p.y, 0) / points.length) : 0;
  const path = points.map((p, idx) => {
    const yScaled = padding.top + (1 - (p.y / maxY)) * chartHeight;
    return `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${yScaled.toFixed(2)}`;
  }).join(" ");
  const avgLineY = padding.top + (1 - (avgY / maxY)) * chartHeight;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = path
    ? `
      <text x="${padding.left}" y="16" fill="#cfd6e4" font-size="12" font-weight="600">Response Time Trend (ms)</text>
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="rgba(255,255,255,0.14)" />
      <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}" stroke="rgba(255,255,255,0.14)" />
      <line x1="${padding.left}" y1="${avgLineY.toFixed(2)}" x2="${padding.left + chartWidth}" y2="${avgLineY.toFixed(2)}" stroke="rgba(96,165,250,0.5)" stroke-dasharray="4 4" />
      <path d="${path}" fill="none" stroke="#7ccf8a" stroke-width="2"></path>
      <text x="${padding.left + 4}" y="${(padding.top + 12).toFixed(2)}" fill="#8fa8f8" font-size="10">Max ${maxY.toFixed(0)} ms</text>
      <text x="${padding.left + 4}" y="${(avgLineY - 6).toFixed(2)}" fill="#8fa8f8" font-size="10">Avg ${avgY.toFixed(2)} ms</text>
      <text x="${padding.left + 4}" y="${(padding.top + chartHeight - 4).toFixed(2)}" fill="#8fa8f8" font-size="10">Min ${minY.toFixed(0)} ms</text>
      <circle cx="${padding.left + chartWidth - 110}" cy="14" r="4" fill="#7ccf8a"></circle>
      <text x="${padding.left + chartWidth - 100}" y="18" fill="#cfd6e4" font-size="10">Local response (ms)</text>
    `
    : `<text x="20" y="40" fill="#aaa">No response data in selected range</text>`;
}

function renderHistoryTable(items) {
  const tbody = document.querySelector("#historyTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const toLocalDateTime = (value) => {
    if (!value) return "—";
    const normalized = typeof value === "string" ? value.replace(" ", "T") : value;
    const asUtc = typeof normalized === "string" && !normalized.endsWith("Z") ? `${normalized}Z` : normalized;
    const parsed = new Date(asUtc);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  };
  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.status || "Unknown"}</td>
      <td>${toLocalDateTime(item.checked_at)}</td>
      <td>${item.local_status_code ?? "—"}/${item.remote_status_code ?? "—"}</td>
      <td class="mono-sm">${item.error_message || item.local_error || item.remote_error || "OK"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderHistoryMetrics(items) {
  const latest = items[0] || {};
  const currentResp = document.getElementById("metricCurrentResponse");
  const avgResp = document.getElementById("metricAvgResponse");
  const up24 = document.getElementById("metricUptime24h");
  const up30d = document.getElementById("metricUptime30d");
  const up1y = document.getElementById("metricUptime1y");

  const responseValues = items.map((i) => i.local_response_ms).filter((n) => Number.isFinite(n));
  const avg = responseValues.length ? responseValues.reduce((a, b) => a + b, 0) / responseValues.length : 0;

  if (currentResp) currentResp.textContent = `${latest.local_response_ms ?? "—"} ms`;
  if (avgResp) avgResp.textContent = `${avg ? avg.toFixed(2) : "—"} ms`;
  if (up24) up24.textContent = `${calcUptimePercent(items, 24).toFixed(2)}%`;
  if (up30d) up30d.textContent = `${calcUptimePercent(items, 24 * 30).toFixed(2)}%`;
  if (up1y) up1y.textContent = `${calcUptimePercent(items, 24 * 365).toFixed(2)}%`;
}

async function loadNodeHistory() {
  if (!currentHistoryNodeId) return;
  const { preset, from, to } = getHistoryRangeSelection();
  const query = new URLSearchParams({ limit: String(currentHistoryLimit), page: String(currentHistoryPage), range: preset });
  if (preset === "custom") {
    if (from) query.set("from", new Date(from).toISOString());
    if (to) query.set("to", new Date(to).toISOString());
  }
  const res = await apiFetch(`/nodes/${currentHistoryNodeId}/history?${query.toString()}`);
  const payload = await res.json();
  const history = Array.isArray(payload) ? payload : (payload.items || []);
  currentHistoryPagination = payload.pagination || { page: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false, total: history.length };
  renderHistoryMetrics(history);
  renderHistoryChart(history);
  renderHistoryTable(history);
  updateHistoryPaginationUI();
}

function updateHistoryPaginationUI() {
  const info = document.getElementById("historyPaginationInfo");
  const prev = document.getElementById("historyPrevBtn");
  const next = document.getElementById("historyNextBtn");
  if (info) {
    info.textContent = `Page ${currentHistoryPagination.page} of ${currentHistoryPagination.totalPages} (${currentHistoryPagination.total} events)`;
  }
  if (prev) prev.disabled = !currentHistoryPagination.hasPrevPage;
  if (next) next.disabled = !currentHistoryPagination.hasNextPage;
}

async function changeHistoryPage(direction) {
  const nextPage = currentHistoryPage + direction;
  if (nextPage < 1 || nextPage > (currentHistoryPagination.totalPages || 1)) return;
  currentHistoryPage = nextPage;
  await loadNodeHistory();
}

async function openNodeDetails(nodeId, nodeName) {
  currentHistoryNodeId = nodeId;
  currentHistoryPage = 1;
  const title = document.getElementById("nodeHistoryTitle");
  if (title) title.textContent = `Monitoring Details - ${nodeName || `Node #${nodeId}`}`;
  updateHistoryRangeUI();
  showNodeHistoryModal();
  await loadNodeHistory();
}

function populateEditChainDropdown() {
  const select = document.getElementById("editChainSelect");
  if (!select) return;
  select.innerHTML = '<option value="">Select a chain...</option>';
  availableChains.forEach((chain) => {
    const option = document.createElement("option");
    option.value = chain.id;
    option.textContent = `${chain.name} (${chain.symbol})`;
    option.dataset.chain = JSON.stringify(chain);
    select.appendChild(option);
  });
}

function populateEditRemoteDropdown(rpcUrls, selectedUrl = "") {
  populateRemoteDropdown("editRemote", rpcUrls, selectedUrl, "editRemoteCustom");
}

function onEditChainSelect() {
  const select = document.getElementById("editChainSelect");
  if (!select) return;
  const selected = select.options[select.selectedIndex];
  if (!selected || !selected.value) return;
  const chain = JSON.parse(selected.dataset.chain);
  // Fill defaults only if empty
  const methodEl = document.getElementById("editRpcMethod");
  const paramsEl = document.getElementById("editParams");
  const respPathEl = document.getElementById("editResponsePath");
  const httpMethodEl = document.getElementById("editHttpMethod");
  if (methodEl && !methodEl.value) methodEl.value = chain.rpc_method || "";
  if (paramsEl && (!paramsEl.value || paramsEl.value === "[]"))
    paramsEl.value = chain.default_params || "[]";
  if (respPathEl && (!respPathEl.value || respPathEl.value === "result"))
    respPathEl.value = chain.response_path || "result";
  if (httpMethodEl && !httpMethodEl.value)
    httpMethodEl.value = chain.http_method || "POST";
  populateEditRemoteDropdown(chain.rpc_urls || []);
}

// ⬇️ Export table to CSV
document.getElementById("exportBtn")?.addEventListener("click", () => {
  const rows = document.querySelectorAll("#statusTable tr");
  const csv = Array.from(rows)
    .map((row) =>
      Array.from(row.children)
        .map((cell) => `"${cell.innerText.replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "node_status.csv";
  a.click();
});

// 🔗 Chain Management Functions

// 📊 Update chain stats and re-render cards (does not replace #chains DOM)
function displayChains() {
  const total = document.getElementById("totalChains");
  const mainnet = document.getElementById("mainnetChains");
  const testnet = document.getElementById("testnetChains");
  if (total) total.textContent = availableChains.length;
  if (mainnet) mainnet.textContent = availableChains.filter(c => !c.is_testnet).length;
  if (testnet) testnet.textContent = availableChains.filter(c => c.is_testnet).length;
  applyFilters();
}

// 🔍 Filter chains based on search and filter
function applyFilters() {
  filteredChains = availableChains.filter((chain) => {
    // Search filter
    const matchesSearch =
      !searchQuery ||
      chain.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chain.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (chain.description &&
        chain.description.toLowerCase().includes(searchQuery.toLowerCase()));

    // Type filter
    const matchesFilter =
      currentFilter === "all" ||
      (currentFilter === "mainnet" && !chain.is_testnet) ||
      (currentFilter === "testnet" && chain.is_testnet);

    return matchesSearch && matchesFilter;
  });

  renderChainCards();
}

// 🎨 Render chain cards
function renderChainCards() {
  const grid = document.getElementById("chainsGrid");
  if (!grid) return;

  if (filteredChains.length === 0) {
    grid.innerHTML = `
      <div class="no-chains">
        <div style="font-size:32px;margin-bottom:12px">🔍</div>
        <h4>No chains found</h4>
        <p>Try adjusting your search or filter criteria</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredChains.map(chain => {
    const urlCount = chain.rpc_urls ? chain.rpc_urls.length : 0;
    return `
      <div class="chain-card">
        <div class="chain-card-top">
          <div>
            <div class="chain-card-name">${chain.name}</div>
            <div class="chain-card-sym">${chain.symbol}</div>
          </div>
          <span class="type-badge ${chain.is_testnet ? "badge-test" : "badge-main"}">${chain.is_testnet ? "Testnet" : "Mainnet"}</span>
        </div>
        <div class="chain-divider"></div>
        <div class="chain-details">
          <div class="chain-detail-row">
            <span class="cd-label">Chain ID</span>
            <span class="cd-value highlight">${chain.chain_id || "—"}</span>
          </div>
          <div class="chain-detail-row">
            <span class="cd-label">Block Time</span>
            <span class="cd-value">${chain.block_time}s</span>
          </div>
          <div class="chain-detail-row">
            <span class="cd-label">RPC Method</span>
            <span class="cd-value">${chain.rpc_method}</span>
          </div>
          <div class="chain-detail-row">
            <span class="cd-label">RPC URLs</span>
            <span class="cd-value">${urlCount} endpoint${urlCount !== 1 ? "s" : ""}</span>
          </div>
        </div>
        ${chain.description ? `<div class="chain-desc">${chain.description}</div>` : ""}
        <div class="chain-card-actions">
          <button class="btn-ce" onclick="editChain(${chain.id})">✏ Edit</button>
          <button class="btn-cd" onclick="deleteChain(${chain.id})">✕ Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

// 🔍 Handle search input
function filterChains() {
  const searchInput = document.getElementById("chainSearch");
  if (!searchInput) return;

  searchQuery = searchInput.value.trim();
  const clearBtn = document.querySelector(".clear-search");

  if (clearBtn) {
    clearBtn.style.display = searchQuery ? "block" : "none";
  }

  applyFilters();
}

// 🧹 Clear search
function clearSearch() {
  const searchInput = document.getElementById("chainSearch");
  if (searchInput) {
    searchInput.value = "";
    searchQuery = "";
    document.querySelector(".clear-search").style.display = "none";
    applyFilters();
  }
}

// 🏷️ Set filter type
function setFilter(type) {
  currentFilter = type;

  // Update filter buttons
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  const activeBtn = document.querySelector(
    `.filter-btn[onclick="setFilter('${type}')"]`
  );
  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  applyFilters();
}

// 🔄 Refresh chains data
async function refreshChains() {
  const loadingSpinner = document.getElementById("chainsLoading");
  if (loadingSpinner) {
    loadingSpinner.style.display = "flex";
  }

  try {
    await fetchChains();
    displayChains();
  } finally {
    if (loadingSpinner) {
      loadingSpinner.style.display = "none";
    }
  }
}

// 🌐 Pull latest chains from Chainlist and persist to DB
async function updateChainsFromChainlist() {
  const updateBtn = document.getElementById("updateBtn");
  const loadingSpinner = document.getElementById("chainsLoading");
  const originalLabel = updateBtn ? updateBtn.textContent : "";

  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.textContent = "⏳ Syncing...";
  }
  if (loadingSpinner) {
    loadingSpinner.style.display = "flex";
  }

  try {
    const res = await apiFetch("/chains/sync", { method: "POST" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    await fetchChains();
    displayChains();

    const added = data.added ?? 0;
    const updated = data.updated ?? 0;
    const skipped = data.skipped ?? 0;
    updateChainsLastSyncLabel(data.syncedAt || new Date().toISOString());
    alert(`Chain sync complete. Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
  } catch (error) {
    alert("Failed to sync chains from Chainlist: " + error.message);
  } finally {
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = originalLabel || "↻ Fetch Latest Chain";
    }
    if (loadingSpinner) {
      loadingSpinner.style.display = "none";
    }
  }
}

// ➕ Show add chain form
function showAddChainForm() {
  currentChainId = null;

  // Check if form elements exist before trying to modify them
  const formTitle = document.getElementById("chainFormTitle");
  const submitBtn = document.getElementById("chainSubmitBtn");
  const formCard = document.getElementById("chainFormCard");
  const form = document.getElementById("chainForm");

  if (!formTitle || !submitBtn || !formCard || !form) {
    alert("Chain form not properly initialized");
    return;
  }

  formTitle.textContent = "Add Custom Chain";
  submitBtn.textContent = "Add Chain";
  form.reset();
  formCard.style.display = "flex";
}

// ✏️ Edit chain
function editChain(id) {
  const chain = availableChains.find((c) => c.id === id);
  if (!chain) {
    alert("Chain not found");
    return;
  }

  currentChainId = id;

  // Check if form elements exist before trying to modify them
  const formTitle = document.getElementById("chainFormTitle");
  const submitBtn = document.getElementById("chainSubmitBtn");

  if (!formTitle || !submitBtn) {
    alert("Chain form not properly initialized");
    return;
  }

  formTitle.textContent = "Edit Chain";
  submitBtn.textContent = "Update Chain";

  // Populate form with error handling
  try {
    const formElements = {
      chainName: document.getElementById("chainName"),
      chainSymbol: document.getElementById("chainSymbol"),
      chainId: document.getElementById("chainId"),
      chainRpcMethod: document.getElementById("chainRpcMethod"),
      chainDefaultParams: document.getElementById("chainDefaultParams"),
      chainResponsePath: document.getElementById("chainResponsePath"),
      chainHttpMethod: document.getElementById("chainHttpMethod"),
      chainBlockTime: document.getElementById("chainBlockTime"),
      chainDescription: document.getElementById("chainDescription"),
      chainExplorer: document.getElementById("chainExplorer"),
      chainRpcUrls: document.getElementById("chainRpcUrls"),
      chainIsTestnet: document.getElementById("chainIsTestnet"),
    };

    // Check if all required form elements exist
    const missingElements = Object.entries(formElements)
      .filter(([, element]) => !element)
      .map(([name]) => name);

    if (missingElements.length > 0) {
      alert(
        "Chain form not properly initialized. Missing elements: " +
          missingElements.join(", ")
      );
      return;
    }

    // Populate form fields
    formElements.chainName.value = chain.name || "";
    formElements.chainSymbol.value = chain.symbol || "";
    formElements.chainId.value = chain.chain_id || "";
    formElements.chainRpcMethod.value = chain.rpc_method || "";
    formElements.chainDefaultParams.value = chain.default_params || "";
    formElements.chainResponsePath.value = chain.response_path || "";
    formElements.chainHttpMethod.value = chain.http_method || "POST";
    formElements.chainBlockTime.value = chain.block_time || "";
    formElements.chainDescription.value = chain.description || "";
    formElements.chainExplorer.value = chain.explorer || "";

    // Handle rpc_urls - ensure it's an array
    const rpcUrls = Array.isArray(chain.rpc_urls) ? chain.rpc_urls : [];
    formElements.chainRpcUrls.value = rpcUrls.join("\n");

    // Handle checkbox
    formElements.chainIsTestnet.checked = Boolean(chain.is_testnet);

    // Show the form
    const formCard = document.getElementById("chainFormCard");
    if (formCard) {
      formCard.style.display = "flex";
    } else {
      alert("Chain form modal not found");
    }
  } catch (error) {
    alert("Error loading chain data: " + error.message);
  }
}

// 🧹 Hide chain form
function hideChainForm() {
  document.getElementById("chainFormCard").style.display = "none";
  currentChainId = null;
}

// ❌ Delete chain
async function deleteChain(id) {
  const chain = availableChains.find((c) => c.id === id);
  if (!chain) return;

  if (
    !confirm(
      `Delete chain "${chain.name}"? This will also delete all nodes using this chain.`
    )
  ) {
    return;
  }

  try {
    const res = await apiFetch(`/chains/${id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await refreshChains();
      await fetchChains(); // Refresh the dropdown too
    } else {
      const error = await res.json();
      alert("Failed to delete chain: " + error.error);
    }
  } catch (error) {
    alert("Failed to delete chain: " + error.message);
  }
}

// 📝 Handle chain form submission
document.getElementById("chainForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const chainData = {
    name: document.getElementById("chainName").value.trim(),
    symbol: document.getElementById("chainSymbol").value.trim(),
    chain_id: document.getElementById("chainId").value
      ? parseInt(document.getElementById("chainId").value)
      : null,
    rpc_method: document.getElementById("chainRpcMethod").value.trim(),
    default_params:
      document.getElementById("chainDefaultParams").value.trim() || "[]",
    response_path:
      document.getElementById("chainResponsePath").value.trim() || "result",
    http_method: document.getElementById("chainHttpMethod").value,
    block_time:
      parseFloat(document.getElementById("chainBlockTime").value) || 15,
    description: document.getElementById("chainDescription").value.trim(),
    explorer: document.getElementById("chainExplorer").value.trim(),
    rpc_urls: document
      .getElementById("chainRpcUrls")
      .value.split("\n")
      .filter((url) => url.trim()),
    is_testnet: document.getElementById("chainIsTestnet").checked,
  };

  try {
    const url = currentChainId ? `/chains/${currentChainId}` : "/chains";
    const method = currentChainId ? "PUT" : "POST";

    const res = await apiFetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chainData),
    });

    if (res.ok) {
      hideChainForm();
      await refreshChains();
      await fetchChains(); // Refresh the dropdown too
      alert(
        "Chain " + (currentChainId ? "updated" : "added") + " successfully!"
      );
    } else {
      const error = await res.json();
      alert(
        "Failed to " +
          (currentChainId ? "update" : "add") +
          " chain: " +
          error.error
      );
    }
  } catch (error) {
    alert(
      "Failed to " +
        (currentChainId ? "update" : "add") +
        " chain: " +
        error.message
    );
  }
});

async function renderPlans() {
  const tab = document.getElementById("packages");
  if (!tab) return;
  const plansWrap = tab.querySelector("#plansWrap");
  if (!plansWrap || !authContext) return;
  const res = await fetch("/plans");
  const plans = await res.json();
  const subRes = await apiFetch("/billing/subscription");
  const sub = await subRes.json();

  plansWrap.innerHTML = plans.map((plan) => {
    const isCurrent = sub?.plan === plan.id;
    const isActivePro = plan.id === "pro" && sub?.plan === "pro" && sub?.lifecycle_state === "active";
    const isPaidUpCurrentMonth = Boolean(
      sub?.plan === "pro" &&
      sub?.current_period_end &&
      new Date(sub.current_period_end).getTime() > Date.now()
    );
    const details = plan.id === "free" ? "Free forever" : `$${plan.priceUsdMonthly}/month`;
    const features = plan.id === "free"
      ? [
          "Monitor up to 5 nodes",
          "Live status dashboard",
          "Node health history",
          "Chain management tools"
        ]
      : [
          "Monitor unlimited nodes",
          `Soft limit ${plan.softLimit} (raise on request)`,
          "Monthly manual payment cycle",
          "7-day grace after period end",
          "2-month retention before anonymize-delete",
          "All Free plan features included"
        ];

    const featureList = features.map((item) => `<li style="margin:6px 0;color:var(--t2);font-size:12px;">- ${item}</li>`).join("");
    return `
      <div class="chain-card" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="chain-card-name">${plan.name}</div>
          ${isCurrent ? '<span class="type-badge badge-main">Current</span>' : ""}
        </div>
        <div style="font-size:22px;font-weight:800;color:var(--t1);">${plan.id === "free" ? "$0" : `$${plan.priceUsdMonthly}`}<span style="font-size:12px;color:var(--t3);font-weight:500;">/month</span></div>
        <div class="chain-desc" style="white-space:normal;">${details}</div>
        <ul style="list-style:none;padding:0;margin:0 0 8px 0;">${featureList}</ul>
        ${
          plan.id === "pro"
            ? isActivePro
              ? `
          <button class="btn-add-chain" disabled>Current Plan</button>
        `
              : `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="btn-add-chain" onclick="startCheckout('subscription')">${sub?.plan === "pro" && sub?.billing_mode === "subscription" && sub?.lifecycle_state === "active" ? "Current: Subscription" : "Subscribe (Card/Bank)"}</button>
            <button class="btn-action" ${isPaidUpCurrentMonth ? "disabled" : ""} onclick="startCheckout('manual_monthly')">${isPaidUpCurrentMonth ? "Paid Through Current Month" : (sub?.lifecycle_state === "blocked" || sub?.lifecycle_state === "retention" ? "Resume: Monthly Payment" : "Pay for Next Month (Manual)")}</button>
          </div>
        `
            : `<button class="btn-add-chain" ${isCurrent && sub?.lifecycle_state === "active" ? "disabled" : ""} onclick="switchToFree()">${isCurrent && sub?.lifecycle_state === "active" ? "Current Plan" : "Switch to Free"}</button>`
        }
      </div>
    `;
  }).join("");

  updateProfileSummary(sub);
}

function updateProfileSummary(sub) {
  if (!authContext) return;
  const toTitleCase = (value) =>
    String(value || "")
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");

  const planName = (sub?.plan || "free").toUpperCase();
  const status = toTitleCase(sub?.status || "active");
  const nodeLimit = sub?.plan === "pro" ? `Soft ${sub?.node_soft_limit || 100}` : "5";

  const planEl = document.getElementById("profilePlanName");
  const statusEl = document.getElementById("profilePlanStatus");
  const nodeLimitEl = document.getElementById("profileNodeLimit");
  const emailEl = document.getElementById("profileEmail");
  const accountTypeEl = document.getElementById("profileAccountType");
  const orgEl = document.getElementById("profileOrganization");
  const tenantIdEl = document.getElementById("profileTenantId");
  const roleEl = document.getElementById("profileRole");

  if (planEl) planEl.textContent = planName;
  if (statusEl) statusEl.textContent = status;
  if (nodeLimitEl) nodeLimitEl.textContent = nodeLimit;
  if (emailEl) emailEl.textContent = authContext.user?.email || "-";
  if (accountTypeEl) accountTypeEl.textContent = toTitleCase(authContext.tenant?.accountType) || "-";
  if (orgEl) orgEl.textContent = authContext.tenant?.organizationName || "N/A";
  if (tenantIdEl) tenantIdEl.textContent = String(authContext.tenant?.id || "-");
  if (roleEl) roleEl.textContent = authContext.tenant?.role || "-";

  const retentionInfoId = "profileRetentionInfo";
  let retentionEl = document.getElementById(retentionInfoId);
  const billingCard = document.getElementById("billingSubscriptionCard");
  const billingSummary = document.getElementById("billingSummaryText");
  const manageBillingBtn = document.getElementById("manageBillingBtn");
  const isPaidUpCurrentMonth = Boolean(
    sub?.plan === "pro" &&
    sub?.current_period_end &&
    new Date(sub.current_period_end).getTime() > Date.now()
  );
  if (billingCard) {
    if (!retentionEl) {
      retentionEl = document.createElement("div");
      retentionEl.id = retentionInfoId;
      retentionEl.style.marginTop = "8px";
      retentionEl.style.fontSize = "12px";
      retentionEl.style.color = "var(--t2)";
      billingCard.appendChild(retentionEl);
    }
    if (billingSummary) {
      const lifecycle = toTitleCase(sub?.lifecycle_state || "active");
      const mode = sub?.billing_mode === "subscription" ? "Subscription (card/bank)" : "Manual monthly";
      billingSummary.textContent = `Lifecycle: ${lifecycle}. Billing mode: ${mode}.`;
    }
    if (manageBillingBtn) {
      manageBillingBtn.disabled = false;
      if (sub?.billing_mode === "subscription") {
        manageBillingBtn.textContent = "Manage Subscription";
        manageBillingBtn.onclick = () => openBillingPortal();
      } else {
        if (isPaidUpCurrentMonth) {
          manageBillingBtn.textContent = "Paid Through Current Month";
          manageBillingBtn.disabled = true;
          manageBillingBtn.onclick = null;
        } else {
          manageBillingBtn.textContent =
            sub?.lifecycle_state === "blocked" || sub?.lifecycle_state === "retention"
              ? "Resume Membership"
              : "Make Monthly Payment";
          manageBillingBtn.onclick = () => startCheckout("manual_monthly");
        }
      }
    }
    if (sub?.retention_delete_at) {
      retentionEl.textContent = `Retention delete date: ${new Date(sub.retention_delete_at).toLocaleString()}`;
    } else if (sub?.current_period_end) {
      retentionEl.textContent = `Current period ends: ${new Date(sub.current_period_end).toLocaleString()}`;
    } else {
      retentionEl.textContent = "No active paid period yet.";
    }
  }
}

async function startCheckout(billingMode = "manual_monthly") {
  try {
    const res = await apiFetch("/billing/checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billingMode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed");
    window.location.href = data.url;
  } catch (error) {
    alert(error.message);
  }
}

function switchToFree() {
  alert("Free plan is automatic when no active Pro subscription exists.");
}

async function openBillingPortal() {
  try {
    const res = await apiFetch("/billing/portal", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Billing portal unavailable");
    window.location.href = data.url;
  } catch (error) {
    alert(error.message);
  }
}

async function initAuthForms() {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const accountType = document.getElementById("registerAccountType");
  const orgField = document.getElementById("orgField");

  if (accountType && orgField) {
    accountType.addEventListener("change", () => {
      orgField.style.display = accountType.value === "business" ? "block" : "none";
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Login failed");
      token = data.token;
      localStorage.setItem("auth_token", token);
      await fetchMe();
      await fetchChains();
      await fetchStatus();
      await renderPlans();
      switchTab("packages");
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        email: document.getElementById("registerEmail").value.trim(),
        password: document.getElementById("registerPassword").value,
        accountType: document.getElementById("registerAccountType").value,
        organizationName: document.getElementById("registerOrgName").value.trim()
      };
      const res = await fetch("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Registration failed");
      token = data.token;
      localStorage.setItem("auth_token", token);
      await fetchMe();
      await fetchChains();
      await fetchStatus();
      await renderPlans();
      switchTab("packages");
    });
  }

  setAuthMode("login");
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginBtn = document.getElementById("authModeLoginBtn");
  const registerBtn = document.getElementById("authModeRegisterBtn");

  if (loginForm) loginForm.style.display = authMode === "login" ? "flex" : "none";
  if (registerForm) registerForm.style.display = authMode === "register" ? "flex" : "none";

  if (loginBtn) {
    loginBtn.style.background = authMode === "login" ? "rgba(167,139,250,0.14)" : "";
    loginBtn.style.borderColor = authMode === "login" ? "rgba(167,139,250,0.35)" : "";
    loginBtn.style.color = authMode === "login" ? "var(--purple)" : "";
  }
  if (registerBtn) {
    registerBtn.style.background = authMode === "register" ? "rgba(167,139,250,0.14)" : "";
    registerBtn.style.borderColor = authMode === "register" ? "rgba(167,139,250,0.35)" : "";
    registerBtn.style.color = authMode === "register" ? "var(--purple)" : "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateHistoryRangeUI();
  initAuthForms();
  const params = new URLSearchParams(window.location.search);
  const billingStatus = params.get("billing");
  const checkoutSessionId = params.get("session_id");
  if (!token) {
    switchTab("packages");
  }

  fetchMe().then(async () => {
    if (authContext) {
      await fetchChains();
      await fetchStatus();
      switchTab("dashboard");
    } else {
      switchTab("packages");
    }
    await renderPlans();

    if (authContext && billingStatus === "success" && checkoutSessionId) {
      try {
        const confirmRes = await apiFetch("/billing/confirm-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: checkoutSessionId })
        });
        const confirmData = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok) {
          alert(confirmData.error || "Checkout confirmation failed.");
        } else if (confirmData.applied) {
          await fetchMe();
          await renderPlans();
        }
      } catch (error) {
        alert(error.message || "Checkout confirmation failed.");
      } finally {
        const cleaned = new URL(window.location.href);
        cleaned.searchParams.delete("billing");
        cleaned.searchParams.delete("session_id");
        window.history.replaceState({}, "", cleaned.toString());
      }
    }
  });
  updateChainsLastSyncLabel();
  setInterval(fetchStatus, 60 * 1000);

  // Attach submit handler for Edit Node modal after DOM is ready
  const editForm = document.getElementById("editNodeForm");
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!editingNodeId) return;

      const node = {
        name: document.getElementById("editName").value.trim(),
        chain_id: parseInt(document.getElementById("editChainSelect").value),
        local_url: document.getElementById("editLocal").value.trim(),
        remote_url: getRemoteUrlValue("editRemote", "editRemoteCustom"),
        custom_method:
          document.getElementById("editRpcMethod").value.trim() || null,
        custom_params:
          document.getElementById("editParams").value.trim() || "[]",
        custom_headers:
          document.getElementById("editHeaders").value.trim() || "{}",
        custom_response_path:
          document.getElementById("editResponsePath").value.trim() || null,
        custom_http_method:
          document.getElementById("editHttpMethod").value || null,
        check_interval:
          parseInt(document.getElementById("editCheckInterval").value) || 60,
      };

      const res = await apiFetch(`/edit/${editingNodeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(node),
      });

      if (res.ok) {
        hideEditNodeModal();
        await fetchStatus();
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        alert("Failed to update node: " + (err.error || "Unknown error"));
      }
    });
  }
});
