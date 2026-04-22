// UI class helpers
function nodeAvatarClass(index) { return `av-${(index % 5) + 1}`; }

function chainPillClass(symbol) {
  const map = { ETH: "cp-blue", BNB: "cp-amber", MATIC: "cp-purple", AVAX: "cp-red", SOL: "cp-teal" };
  return map[symbol] || "cp-blue";
}

function statusPillClass(status) {
  if (status === "Healthy") return "sp-ok";
  if (status === "Degrading") return "sp-warn";
  if (status === "Out of Sync") return "sp-err";
  return "sp-off";
}

function delayChipClass(delay) {
  if (!delay || delay === "—") return "dc-ok";
  const n = parseInt(delay);
  if (isNaN(n)) return "dc-ok";
  if (n <= 3) return "dc-ok";
  if (n <= 10) return "dc-warn";
  return "dc-err";
}

// 📊 Fetch node status and update dashboard
async function fetchStatus() {
  const res = await fetch("/status");
  let data = await res.json();

  data.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const tbody = document.querySelector("#statusTable tbody");
  tbody.innerHTML = "";

  const total = data.length;
  const healthy = data.filter(n => n.status === "Healthy").length;
  const warnings = data.filter(n => n.status === "Degrading").length;
  const errors = data.filter(n => n.status === "Out of Sync" || n.status === "Offline").length;

  const statTotal = document.getElementById("statTotal");
  const statHealthy = document.getElementById("statHealthy");
  const statWarning = document.getElementById("statWarning");
  const statError = document.getElementById("statError");
  const panelSubtitle = document.getElementById("panelSubtitle");

  if (statTotal) statTotal.textContent = total;
  if (statHealthy) statHealthy.textContent = healthy;
  if (statWarning) statWarning.textContent = warnings;
  if (statError) statError.textContent = errors;
  if (panelSubtitle) panelSubtitle.textContent = `${total} node${total !== 1 ? "s" : ""} monitored`;

  data.forEach((node, index) => {
    const row = document.createElement("tr");
    const avClass = nodeAvatarClass(index);
    const cpClass = chainPillClass(node.chain_symbol || "");
    const spClass = statusPillClass(node.status);
    const dcClass = delayChipClass(node.delay);
    const initials = (node.name || "??").substring(0, 2).toUpperCase();
    const chainLabel = `${node.chain_name || "Unknown"} (${node.chain_symbol || "?"})`;
    const delay = node.delay ?? "—";
    const error = node.error ?? "";
    const lastChecked = node.lastChecked ? new Date(node.lastChecked).toLocaleString() : "—";

    row.innerHTML = `
      <td>
        <div class="node-cell">
          <div class="node-av ${avClass}">${initials}</div>
          <div>
            <div class="node-nm">${node.name}</div>
            <div class="node-id">#${node.id}</div>
          </div>
        </div>
      </td>
      <td><span class="chain-pill ${cpClass}"><span class="cdot"></span>${chainLabel}</span></td>
      <td><span class="status-pill ${spClass}"><span class="sdot"></span>${node.status}</span></td>
      <td class="mono">${node.localHeight ?? "—"}</td>
      <td class="mono">${node.remoteHeight ?? "—"}</td>
      <td><span class="delay-chip ${dcClass}">${delay}</span></td>
      <td class="mono-sm">${lastChecked}</td>
      <td class="err-text" style="color:var(--red);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${error}</td>
      <td>
        <div class="act-wrap">
          <button class="btn-ed" onclick="editNode(${node.id})">✏ Edit</button>
          <button class="btn-dl" onclick="deleteNode(${node.id})">✕ Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// 🌐 Global variables for chains
let availableChains = [];
let currentNodeId = null;
let currentChainId = null;
let filteredChains = [];
let currentFilter = "all";
let searchQuery = "";
let editingNodeId = null;

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
  try {
    console.log("Fetching chains...");
    const res = await fetch("/chains");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    availableChains = await res.json();
    console.log("Chains fetched:", availableChains.length, "chains");
    populateChainDropdown();
    // Also keep edit modal dropdown in sync if present
    if (typeof populateEditChainDropdown === "function") {
      populateEditChainDropdown();
    }
    displayChains(); // Also display chains in the chains tab
  } catch (error) {
    console.error("Failed to fetch chains:", error);
    alert("❌ Failed to load chains: " + error.message);
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

  const url = currentNodeId ? `/edit/${currentNodeId}` : "/add";
  const method = currentNodeId ? "PUT" : "POST";

  const res = await fetch(url, {
    method: method,
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
    alert("❌ Failed to add node: " + (err.error || "Unknown error"));
  }
});

// ❌ Delete node
async function deleteNode(id) {
  if (!confirm(`Delete this node?`)) return;

  const res = await fetch(`/delete/${id}`, {
    method: "DELETE",
  });

  if (res.ok) {
    await fetchStatus(); // ✅ Live reload
  } else {
    alert("❌ Failed to delete node.");
  }
}

// ✏️ Edit node (open and populate modal)
async function editNode(id) {
  try {
    const res = await fetch(`/nodes/${id}`);
    if (!res.ok) {
      return alert("❌ Failed to fetch node data.");
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
    alert("❌ Failed to load node data: " + error.message);
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
    const res = await fetch("/chains/sync", { method: "POST" });
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
    alert(`✅ Chain sync complete. Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
  } catch (error) {
    alert("❌ Failed to sync chains from Chainlist: " + error.message);
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
    console.error("Chain form elements not found");
    alert("❌ Chain form not properly initialized");
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
    console.error("Chain not found:", id);
    alert("❌ Chain not found");
    return;
  }

  console.log("Editing chain:", chain); // Debug log

  currentChainId = id;

  // Check if form elements exist before trying to modify them
  const formTitle = document.getElementById("chainFormTitle");
  const submitBtn = document.getElementById("chainSubmitBtn");

  if (!formTitle || !submitBtn) {
    console.error("Chain form elements not found");
    alert("❌ Chain form not properly initialized");
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
      console.error("Missing form elements:", missingElements);
      alert(
        "❌ Chain form not properly initialized. Missing elements: " +
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
      console.error("Chain form card not found");
      alert("❌ Chain form modal not found");
    }
  } catch (error) {
    console.error("Error populating chain form:", error);
    alert("❌ Error loading chain data: " + error.message);
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
    const res = await fetch(`/chains/${id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await refreshChains();
      await fetchChains(); // Refresh the dropdown too
    } else {
      const error = await res.json();
      alert("❌ Failed to delete chain: " + error.error);
    }
  } catch (error) {
    alert("❌ Failed to delete chain: " + error.message);
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

    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chainData),
    });

    if (res.ok) {
      hideChainForm();
      await refreshChains();
      await fetchChains(); // Refresh the dropdown too
      alert(
        "✅ Chain " + (currentChainId ? "updated" : "added") + " successfully!"
      );
    } else {
      const error = await res.json();
      alert(
        "❌ Failed to " +
          (currentChainId ? "update" : "add") +
          " chain: " +
          error.error
      );
    }
  } catch (error) {
    alert(
      "❌ Failed to " +
        (currentChainId ? "update" : "add") +
        " chain: " +
        error.message
    );
  }
});

// 🚀 Load data on page load
document.addEventListener("DOMContentLoaded", () => {
  fetchChains(); // Load available chains
  fetchStatus(); // Initial status load
  updateChainsLastSyncLabel();
  setInterval(fetchStatus, 60 * 1000); // Auto-refresh every 60 seconds

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

      const res = await fetch(`/edit/${editingNodeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(node),
      });

      if (res.ok) {
        hideEditNodeModal();
        await fetchStatus();
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        alert("❌ Failed to update node: " + (err.error || "Unknown error"));
      }
    });
  }
});
