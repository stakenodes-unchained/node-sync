// 📊 Fetch node status and update dashboard
async function fetchStatus() {
  const res = await fetch("/status");
  let data = await res.json();

  // 🔤 Sort by name alphabetically (case-insensitive)
  data.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const tbody = document.querySelector("#statusTable tbody");
  tbody.innerHTML = "";

  data.forEach((node) => {
    const row = document.createElement("tr");

    // 🟢🟡🔴 Color logic based on refined status
    row.className =
      node.status === "Healthy"
        ? "healthy"
        : node.status === "Degrading"
        ? "degrading"
        : node.status === "Out of Sync"
        ? "out-of-sync"
        : node.status === "Offline"
        ? "offline"
        : "unknown";

    row.innerHTML = `
      <td>${node.name}</td>
      <td>${node.chain_name || 'Unknown'} (${node.chain_symbol || '?'})</td>
      <td>${node.status}</td>
      <td>${node.localHeight ?? "—"}</td>
      <td>${node.remoteHeight ?? "—"}</td>
      <td>${node.delay ?? "—"}</td>
      <td>${new Date(node.lastChecked).toLocaleString()}</td>
      <td>${node.error ?? ""}</td>
      <td>
        <button onclick="editNode(${node.id})">✏️ Edit</button>
        <button onclick="deleteNode(${node.id})">🗑 Delete</button>
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
let currentFilter = 'all';
let searchQuery = '';

// 📡 Fetch available chains
async function fetchChains() {
  try {
    console.log('Fetching chains...');
    const res = await fetch("/chains");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    availableChains = await res.json();
    console.log('Chains fetched:', availableChains.length, 'chains');
    populateChainDropdown();
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
  
  availableChains.forEach(chain => {
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

// 📝 Populate form with chain defaults
function populateChainDefaults(chain) {
  document.getElementById("rpcMethod").value = chain.rpc_method || "";
  document.getElementById("params").value = chain.default_params || "[]";
  document.getElementById("responsePath").value = chain.response_path || "result";
  document.getElementById("httpMethod").value = chain.http_method || "POST";
  
  // Pre-fill remote URL with first available RPC
  if (chain.rpc_urls && chain.rpc_urls.length > 0) {
    document.getElementById("remote").value = chain.rpc_urls[0];
  }
}

// 🧹 Clear chain defaults
function clearChainDefaults() {
  document.getElementById("rpcMethod").value = "";
  document.getElementById("params").value = "[]";
  document.getElementById("responsePath").value = "result";
  document.getElementById("httpMethod").value = "POST";
  document.getElementById("remote").value = "";
}

// ➕ Handle Add Node form
document.getElementById("nodeForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const chainId = document.getElementById("chainSelect").value;
  if (!chainId) {
    alert("❌ Please select a chain");
    return;
  }

  const node = {
    name: document.getElementById("name").value.trim(),
    chain_id: parseInt(chainId),
    local_url: document.getElementById("local").value.trim(),
    remote_url: document.getElementById("remote").value.trim(),
    custom_method: document.getElementById("rpcMethod").value.trim() || null,
    custom_params: document.getElementById("params").value.trim() || "[]",
    custom_headers: document.getElementById("headers").value.trim() || "{}",
    custom_response_path: document.getElementById("responsePath").value.trim() || null,
    custom_http_method: document.getElementById("httpMethod").value || null,
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

// ✏️ Edit node (populate form for update)
async function editNode(id) {
  try {
    // Fetch the specific node data for editing
    const res = await fetch(`/nodes/${id}`);
    if (!res.ok) {
      return alert("❌ Failed to fetch node data.");
    }
    const node = await res.json();

    currentNodeId = id;

    // Ensure chains are loaded before populating the form
    if (availableChains.length === 0) {
      await fetchChains();
    }

    // Populate form
    document.getElementById("name").value = node.name;
    document.getElementById("chainSelect").value = node.chain_id;
    
    // Trigger chain selection to populate defaults
    onChainSelect();
    
    // Override with custom values if they exist
    document.getElementById("local").value = node.local_url || "";
    document.getElementById("remote").value = node.remote_url || "";
    
    if (node.custom_method) {
      document.getElementById("rpcMethod").value = node.custom_method;
    }
    if (node.custom_params) {
      document.getElementById("params").value = node.custom_params;
    }
    if (node.custom_headers) {
      document.getElementById("headers").value = node.custom_headers;
    }
    if (node.custom_response_path) {
      document.getElementById("responsePath").value = node.custom_response_path;
    }
    if (node.custom_http_method) {
      document.getElementById("httpMethod").value = node.custom_http_method;
    }

    // Switch to Add Node tab
    switchTab("addNode");
    alert("📝 Edit the fields and resubmit to update.");
  } catch (error) {
    alert("❌ Failed to load node data: " + error.message);
  }
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

// 📊 Display chains in the enhanced UI
function displayChains() {
  const container = document.getElementById("chains");
  if (!container) return;

  // Show loading state
  container.innerHTML = `
    <div class="chains-header">
      <div class="chains-title">
        <h3>🌐 Blockchain Networks</h3>
        <p>Manage supported blockchain networks and their configurations</p>
      </div>
      <div class="chains-stats">
        <div class="stat-item">
          <span class="stat-number" id="totalChains">${availableChains.length}</span>
          <span class="stat-label">Total</span>
        </div>
        <div class="stat-item">
          <span class="stat-number" id="mainnetChains">${availableChains.filter(c => !c.is_testnet).length}</span>
          <span class="stat-label">Mainnet</span>
        </div>
        <div class="stat-item">
          <span class="stat-number" id="testnetChains">${availableChains.filter(c => c.is_testnet).length}</span>
          <span class="stat-label">Testnet</span>
        </div>
      </div>
    </div>

    <div class="chains-controls">
      <div class="search-box">
        <input type="text" id="chainSearch" placeholder="🔍 Search chains..." oninput="filterChains()">
        <button class="clear-search" onclick="clearSearch()" style="display: none;">✕</button>
      </div>
      <div class="filter-buttons">
        <button class="filter-btn active" onclick="setFilter('all')">All</button>
        <button class="filter-btn" onclick="setFilter('mainnet')">Mainnet</button>
        <button class="filter-btn" onclick="setFilter('testnet')">Testnet</button>
      </div>
      <div class="action-buttons">
        <button class="btn-secondary" onclick="refreshChains()">
          <span class="btn-icon">🔄</span> Refresh
        </button>
        <button class="btn-primary" onclick="showAddChainForm()">
          <span class="btn-icon">➕</span> Add Chain
        </button>
      </div>
    </div>

    <div class="chains-container">
      <div class="loading-spinner" id="chainsLoading" style="display: none;">
        <div class="spinner"></div>
        <p>Loading chains...</p>
      </div>
      <div class="chains-grid" id="chainsGrid"></div>
    </div>
  `;

  // Apply current filters
  applyFilters();
}

// 🔍 Filter chains based on search and filter
function applyFilters() {
  filteredChains = availableChains.filter(chain => {
    // Search filter
    const matchesSearch = !searchQuery || 
      chain.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chain.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (chain.description && chain.description.toLowerCase().includes(searchQuery.toLowerCase()));

    // Type filter
    const matchesFilter = currentFilter === 'all' ||
      (currentFilter === 'mainnet' && !chain.is_testnet) ||
      (currentFilter === 'testnet' && chain.is_testnet);

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
        <div class="no-chains-icon">🔍</div>
        <h4>No chains found</h4>
        <p>Try adjusting your search or filter criteria</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredChains.map(chain => `
    <div class="chain-card">
      <div class="chain-card-header">
        <div class="chain-info">
          <h4>${chain.name}</h4>
          <div class="chain-symbol">${chain.symbol}</div>
        </div>
        <div class="chain-type-badge ${chain.is_testnet ? 'testnet' : 'mainnet'}">
          ${chain.is_testnet ? 'Testnet' : 'Mainnet'}
        </div>
      </div>
      
      <div class="chain-details">
        <div class="detail-row">
          <span class="detail-label">Chain ID:</span>
          <span class="detail-value">${chain.chain_id || '—'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">RPC Method:</span>
          <span class="detail-value">${chain.rpc_method}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Block Time:</span>
          <span class="detail-value">${chain.block_time}s</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">RPC URLs:</span>
          <span class="detail-value">${chain.rpc_urls ? chain.rpc_urls.length : 0}</span>
        </div>
        ${chain.description ? `
        <div class="detail-row">
          <span class="detail-label">Description:</span>
          <span class="detail-value">${chain.description.substring(0, 50)}${chain.description.length > 50 ? '...' : ''}</span>
        </div>
        ` : ''}
      </div>
      
      <div class="chain-actions">
        <button class="edit-btn" onclick="editChain(${chain.id})">
          ✏️ Edit
        </button>
        <button class="delete-btn" onclick="deleteChain(${chain.id})">
          🗑 Delete
        </button>
      </div>
    </div>
  `).join('');
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
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.classList.remove("active");
  });
  
  const activeBtn = document.querySelector(`.filter-btn[onclick="setFilter('${type}')"]`);
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

// ➕ Show add chain form
function showAddChainForm() {
  currentChainId = null;
  
  // Check if form elements exist before trying to modify them
  const formTitle = document.getElementById("chainFormTitle");
  const submitBtn = document.getElementById("chainSubmitBtn");
  const formCard = document.getElementById("chainFormCard");
  const form = document.getElementById("chainForm");
  
  if (!formTitle || !submitBtn || !formCard || !form) {
    console.error('Chain form elements not found');
    alert('❌ Chain form not properly initialized');
    return;
  }
  
  formTitle.textContent = "Add Custom Chain";
  submitBtn.textContent = "Add Chain";
  form.reset();
  formCard.style.display = "block";
}

// ✏️ Edit chain
function editChain(id) {
  const chain = availableChains.find(c => c.id === id);
  if (!chain) {
    console.error('Chain not found:', id);
    alert('❌ Chain not found');
    return;
  }

  console.log('Editing chain:', chain); // Debug log

  currentChainId = id;
  
  // Check if form elements exist before trying to modify them
  const formTitle = document.getElementById("chainFormTitle");
  const submitBtn = document.getElementById("chainSubmitBtn");
  
  if (!formTitle || !submitBtn) {
    console.error('Chain form elements not found');
    alert('❌ Chain form not properly initialized');
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
      chainIsTestnet: document.getElementById("chainIsTestnet")
    };
    
    // Check if all required form elements exist
    const missingElements = Object.entries(formElements)
      .filter(([name, element]) => !element)
      .map(([name]) => name);
    
    if (missingElements.length > 0) {
      console.error('Missing form elements:', missingElements);
      alert('❌ Chain form not properly initialized. Missing elements: ' + missingElements.join(', '));
      return;
    }
    
    // Populate form fields
    formElements.chainName.value = chain.name || '';
    formElements.chainSymbol.value = chain.symbol || '';
    formElements.chainId.value = chain.chain_id || '';
    formElements.chainRpcMethod.value = chain.rpc_method || '';
    formElements.chainDefaultParams.value = chain.default_params || '';
    formElements.chainResponsePath.value = chain.response_path || '';
    formElements.chainHttpMethod.value = chain.http_method || 'POST';
    formElements.chainBlockTime.value = chain.block_time || '';
    formElements.chainDescription.value = chain.description || '';
    formElements.chainExplorer.value = chain.explorer || '';
    
    // Handle rpc_urls - ensure it's an array
    const rpcUrls = Array.isArray(chain.rpc_urls) ? chain.rpc_urls : [];
    formElements.chainRpcUrls.value = rpcUrls.join('\n');
    
    // Handle checkbox
    formElements.chainIsTestnet.checked = Boolean(chain.is_testnet);

    // Show the form
    const formCard = document.getElementById("chainFormCard");
    if (formCard) {
      formCard.style.display = "block";
    } else {
      console.error('Chain form card not found');
      alert('❌ Chain form modal not found');
    }
  } catch (error) {
    console.error('Error populating chain form:', error);
    alert('❌ Error loading chain data: ' + error.message);
  }
}

// 🧹 Hide chain form
function hideChainForm() {
  document.getElementById("chainFormCard").style.display = "none";
  currentChainId = null;
}

// ❌ Delete chain
async function deleteChain(id) {
  const chain = availableChains.find(c => c.id === id);
  if (!chain) return;

  if (!confirm(`Delete chain "${chain.name}"? This will also delete all nodes using this chain.`)) {
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
    chain_id: document.getElementById("chainId").value ? parseInt(document.getElementById("chainId").value) : null,
    rpc_method: document.getElementById("chainRpcMethod").value.trim(),
    default_params: document.getElementById("chainDefaultParams").value.trim() || '[]',
    response_path: document.getElementById("chainResponsePath").value.trim() || 'result',
    http_method: document.getElementById("chainHttpMethod").value,
    block_time: parseFloat(document.getElementById("chainBlockTime").value) || 15,
    description: document.getElementById("chainDescription").value.trim(),
    explorer: document.getElementById("chainExplorer").value.trim(),
    rpc_urls: document.getElementById("chainRpcUrls").value.split('\n').filter(url => url.trim()),
    is_testnet: document.getElementById("chainIsTestnet").checked
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
      alert("✅ Chain " + (currentChainId ? "updated" : "added") + " successfully!");
    } else {
      const error = await res.json();
      alert("❌ Failed to " + (currentChainId ? "update" : "add") + " chain: " + error.error);
    }
  } catch (error) {
    alert("❌ Failed to " + (currentChainId ? "update" : "add") + " chain: " + error.message);
  }
});

// 🚀 Load data on page load
document.addEventListener("DOMContentLoaded", () => {
  fetchChains();                          // Load available chains
  fetchStatus();                          // Initial status load
  setInterval(fetchStatus, 60 * 1000);   // Auto-refresh every 60 seconds
});
