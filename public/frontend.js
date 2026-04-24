// ── Searchable Select ──────────────────────────────────────────────────────────
class SearchableSelect {
constructor(selectEl, placeholder = 'Search...') {
this.select = selectEl;
this.placeholder = placeholder;
this.isOpen = false;
this._build();
this._bindOutsideClick();
}

_build() {
this.wrapper = document.createElement('div');
this.wrapper.className = 'ss-wrapper';

this.trigger = document.createElement('button');
this.trigger.type = 'button';
this.trigger.className = 'ss-trigger ss-placeholder';
this.trigger.addEventListener('click', () => this._toggle());

this.dropdown = document.createElement('div');
this.dropdown.className = 'ss-dropdown';

this.searchInput = document.createElement('input');
this.searchInput.type = 'text';
this.searchInput.className = 'ss-search';
this.searchInput.placeholder = this.placeholder;
this.searchInput.addEventListener('input', () => this._renderList(this.searchInput.value));
this.searchInput.addEventListener('click', e => e.stopPropagation());

this.list = document.createElement('div');
this.list.className = 'ss-list';

this.dropdown.appendChild(this.searchInput);
this.dropdown.appendChild(this.list);
this.wrapper.appendChild(this.trigger);

this.select.style.display = 'none';
this.select.parentNode.insertBefore(this.wrapper, this.select.nextSibling);

this._updateTrigger();
}

// Call after the underlying <select> options change
refresh() {
this._syncDisabled();
this._updateTrigger();
if (this.isOpen) this._renderList(this.searchInput.value);
}

// Set value programmatically (does not fire change event)
setValue(value) {
this.select.value = String(value);
this._syncDisabled();
this._updateTrigger();
}

_syncDisabled() {
this.trigger.disabled = this.select.disabled;
this.wrapper.classList.toggle('ss-disabled', this.select.disabled);
}

_updateTrigger() {
const opt = this.select.options[this.select.selectedIndex];
const hasValue = opt && opt.value && !opt.disabled;
this.trigger.textContent = hasValue ? opt.textContent : (this.select.options[0]?.textContent || 'Select...');
this.trigger.classList.toggle('ss-placeholder', !hasValue);
}

_renderList(query) {
this.list.innerHTML = '';
const q = query.toLowerCase();
let count = 0;
Array.from(this.select.options).forEach(opt => {
if (!opt.value || opt.disabled) return;
if (q && !opt.textContent.toLowerCase().includes(q)) return;
const item = document.createElement('div');
item.className = 'ss-option' + (opt.value === this.select.value ? ' ss-selected' : '');
item.textContent = opt.textContent;
item.addEventListener('click', () => this._select(opt.value));
this.list.appendChild(item);
count++;
});
if (count === 0) {
const empty = document.createElement('div');
empty.className = 'ss-empty';
empty.textContent = 'No results';
this.list.appendChild(empty);
}
}

_select(value) {
this.select.value = value;
this.select.dispatchEvent(new Event('change'));
this._updateTrigger();
this._close();
}

_toggle() {
if (this.select.disabled) return;
this.isOpen ? this._close() : this._open();
}

// Position the dropdown directly under the trigger.
// If the trigger has scrolled out of view, close instead.
_updatePosition() {
const rect = this.trigger.getBoundingClientRect();
if (rect.bottom < 0 || rect.top > window.innerHeight) {
this._close();
return;
}
this.dropdown.style.top = (rect.bottom + 6) + 'px';
this.dropdown.style.left = rect.left + 'px';
this.dropdown.style.width = rect.width + 'px';
}

_open() {
this.isOpen = true;
document.body.appendChild(this.dropdown);
this._updatePosition();
this.searchInput.value = '';
this._renderList('');
requestAnimationFrame(() => this.searchInput.focus());

// Listen for any scroll (capture catches modals too) and window resize
this._onScroll = () => this._updatePosition();
window.addEventListener('scroll', this._onScroll, true);
window.addEventListener('resize', this._onScroll);
}

_close() {
if (!this.isOpen) return;
this.isOpen = false;
window.removeEventListener('scroll', this._onScroll, true);
window.removeEventListener('resize', this._onScroll);
if (this.dropdown.parentNode) this.dropdown.parentNode.removeChild(this.dropdown);
}

_bindOutsideClick() {
document.addEventListener('click', e => {
if (this.isOpen && !this.wrapper.contains(e.target) && !this.dropdown.contains(e.target)) {
this._close();
}
});
}
}

// Registry of all SearchableSelect instances, keyed by select element id
const searchableSelects = {};
// ──────────────────────────────────────────────────────────────────────────────

// ── Tag state ─────────────────────────────────────────────────────────────────
var allNodeData = []; // full list from last /status fetch
var activeTagFilter = null; // currently selected tag (null = show all)
var tagSearchQuery = ''; // live text search across node tags
var addNodeTags = []; // tags being added in the Add Node form
var editNodeTags = []; // tags being edited in the Edit Node modal
// ──────────────────────────────────────────────────────────────────────────────

// Format chain dropdown label: keeps the name as-is, uppercases the symbol in brackets
// e.g. "Abey Testnet" + "tABEY" => "Abey Testnet (TABEY)"
function formatChainLabel(name, symbol) {
 return name + ' (' + symbol.toUpperCase() + ')';
}

// UI class helpers
function nodeAvatarClass(index) { return `av-${(index % 5) + 1}`; }

// Returns the llamao icon URL only when both chain_name and chain_symbol from the node
// match a chain in availableChains (name + symbol exact match), AND the chain has an
// icon slug. chain_icon is now included directly in the /status response via the DB JOIN.
function getChainIconUrl(chainName, chainSymbol, chainIcon) {
  if (!chainName || !chainSymbol || !chainIcon) return null;
  const matched = availableChains.find(c => c.name === chainName && c.symbol === chainSymbol);
  if (!matched) return null;
  return `https://icons.llamao.fi/icons/chains/rsz_${chainIcon}.jpg`;
}

// Fallback: replace a broken chain icon <img> with the default initials avatar
function handleChainIconError(img, avClass, initials) {
  const div = document.createElement('div');
  div.className = `node-av ${avClass}`;
  div.textContent = initials;
  img.parentNode.replaceChild(div, img);
}

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

// Convert a date to a short relative string like "5s ago", "2m ago", "1h ago"
function timeAgo(dateStr) {
  var seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
    if (seconds < 60) return seconds + 's ago';
  var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
  var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
}

// Update just the text in every Last Checked cell without re-drawing the table
function updateRelativeTimes() {
  var cells = document.querySelectorAll('.last-checked-cell[data-checked]');
    cells.forEach(function(cell) {
  var ts = cell.getAttribute('data-checked');
  if (ts) cell.textContent = timeAgo(ts);
  });
}

// 📊 Fetch node status and update dashboard
async function fetchStatus() {
  const res = await fetch("/status");
  let data = await res.json();

  data.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  allNodeData = data;

  const total = data.length;
  const healthy = data.filter(n => n.status === "Healthy").length;
  const warnings = data.filter(n => n.status === "Degrading").length;
  const errors = data.filter(n => n.status === "Out of Sync" || n.status === "Offline").length;
  const disabled = data.filter(n => n.status === "Disabled").length;

  const statTotal = document.getElementById("statTotal");
  const statHealthy = document.getElementById("statHealthy");
  const statWarning = document.getElementById("statWarning");
  const statError = document.getElementById("statError");
  const statDisabled = document.getElementById("statDisabled");
  const panelSubtitle = document.getElementById("panelSubtitle");

  if (statTotal) statTotal.textContent = total;
  if (statHealthy) statHealthy.textContent = healthy;
  if (statWarning) statWarning.textContent = warnings;
  if (statError) statError.textContent = errors;
  if (statDisabled) statDisabled.textContent = disabled;
  if (panelSubtitle) panelSubtitle.textContent = `${total} node${total !== 1 ? "s" : ""} monitored`;

renderNodeTable();
renderTagFilterBar();
}

// Render the node table, applying the active tag filter and/or tag search query
function renderNodeTable() {
var data = allNodeData;
if (activeTagFilter) {
data = data.filter(function(node) {
return (node.tags || []).includes(activeTagFilter);
});
}
if (tagSearchQuery) {
var q = tagSearchQuery.toLowerCase();
data = data.filter(function(node) {
return (node.tags || []).some(function(tag) {
return tag.toLowerCase().includes(q);
});
});
}

var tbody = document.querySelector("#statusTable tbody");
tbody.innerHTML = "";

data.forEach(function(node, index) {
var row = document.createElement("tr");
var avClass = nodeAvatarClass(index);
var cpClass = chainPillClass(node.chain_symbol || "");
var spClass = statusPillClass(node.status);
var dcClass = delayChipClass(node.delay);
var initials = (node.name || "??").substring(0, 2).toUpperCase();
var chainLabel = (node.chain_name || "Unknown") + " (" + (node.chain_symbol || "?") + ")";
var delay = node.delay !== null && node.delay !== undefined ? node.delay : "—";
var error = node.error || "";
var lastCheckedFull = node.lastChecked ? new Date(node.lastChecked).toLocaleString() : "—";
var lastChecked = node.lastChecked ? timeAgo(node.lastChecked) : "—";
var tagPillsHtml = (node.tags || []).map(function(tag) {
return '<span class="node-tag-pill">' + tag + '</span>';
}).join('');

var iconUrl = getChainIconUrl(node.chain_name, node.chain_symbol, node.chain_icon);
var avatarHtml = iconUrl
? `<img class="node-av-icon" src="${iconUrl}" alt="${initials}" onerror="handleChainIconError(this,'${avClass}','${initials}')">`
: `<div class="node-av ${avClass}">${initials}</div>`;

    row.innerHTML = `
      <td>
        <div class="node-cell">
        ${avatarHtml}
          <div>
            <div class="node-nm">${node.name}</div>
            <div class="node-id">#${node.id}</div>
            ${tagPillsHtml ? '<div class="node-tags">' + tagPillsHtml + '</div>' : ''}
          </div>
        </div>
      </td>
      <td><span class="chain-pill ${cpClass}"><span class="cdot"></span>${chainLabel}</span></td>
      <td><span class="status-pill ${spClass}"><span class="sdot"></span>${node.status}</span></td>
      <td class="mono">${node.localHeight ?? "—"}</td>
      <td class="mono">${node.remoteHeight ?? "—"}</td>
      <td><span class="delay-chip ${dcClass}">${delay}</span></td>
      <td class="mono-sm last-checked-cell" data-checked="${node.lastChecked || ''}" data-tooltip="${lastCheckedFull}">${lastChecked}</td>
      <td class="err-text${error ? ' err-clickable' : ''}" style="color:var(--red);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis${error ? ';cursor:pointer' : ''}" ${error ? `onclick="showErrorDetail(this)" data-error="${error.replace(/"/g, '&quot;')}"` : ''}>${error || '—'}</td>
      <td>
      <button class="btn-more" onclick="openNodeMenu(event, ${node.id})" data-active="${node.status === 'Disabled' ? '0' : '1'}">···</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// Build the tag filter bar (dropdown + search) above the node table
function renderTagFilterBar() {
var bar = document.getElementById('tagFilterBar');
if (!bar) return;

var allTags = new Set();
allNodeData.forEach(function(node) {
(node.tags || []).forEach(function(tag) { allTags.add(tag); });
});

if (allTags.size === 0 && !tagSearchQuery) {
bar.style.display = 'none';
return;
}

bar.style.display = 'flex';

var tags = Array.from(allTags).sort();
var dropdownLabel = activeTagFilter || 'All Tags';

var itemsHtml = [
'<div class="tag-dropdown-item' + (!activeTagFilter ? ' active' : '') + '" onclick="setTagFilter(null)">All Tags</div>'
].concat(tags.map(function(tag) {
var escaped = tag.replace(/'/g, "\\'").replace(/"/g, '&quot;');
return '<div class="tag-dropdown-item' + (activeTagFilter === tag ? ' active' : '') + '" onclick="setTagFilter(\'' + escaped + '\')">' + tag + '</div>';
})).join('');

bar.innerHTML =
'<span class="tag-filter-label">Filter by Tag:</span>' +
'<div class="tag-dropdown-wrapper" id="tagDropdownWrapper">' +
'<button type="button" class="tag-dropdown-trigger' + (activeTagFilter ? ' active' : '') + '" id="tagDropdownTrigger" onclick="toggleTagDropdown(event)">' +
'<span>' + dropdownLabel + '</span>' +
'<svg width="10" height="7" viewBox="0 0 10 7" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
'</button>' +
'<div class="tag-dropdown-menu" id="tagDropdownMenu" style="display:none;">' + itemsHtml + '</div>' +
'</div>' +
'<div class="tag-search-wrap">' +
'<svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="white" stroke-width="1.5"/><path d="M11 11l3 3" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>' +
'<input type="text" class="tag-search-input" id="tagSearchInput" placeholder="Search tags..." value="' + tagSearchQuery.replace(/"/g, '&quot;') + '" oninput="onTagSearch(this.value)" />' +
'</div>';
}

// Toggle the tag dropdown open/closed
function toggleTagDropdown(event) {
event.stopPropagation();
var menu = document.getElementById('tagDropdownMenu');
if (!menu) return;
menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Close the tag dropdown
function closeTagDropdown() {
var menu = document.getElementById('tagDropdownMenu');
if (menu) menu.style.display = 'none';
}

// Set tag filter from the dropdown and re-render
function setTagFilter(tag) {
activeTagFilter = tag;
closeTagDropdown();
renderNodeTable();
renderTagFilterBar();
}

// Live tag text search — filters nodes whose tags match the typed query
function onTagSearch(query) {
tagSearchQuery = query;
renderNodeTable();
}

// ── Tag input widget helpers ────────────────────────────────────────────────

// Draw tag chips inside the wrap div, each with an × remove button
function renderTagChips(tags, wrapId, removeCallback) {
var wrap = document.getElementById(wrapId);
if (!wrap) return;
var input = wrap.querySelector('input');
wrap.querySelectorAll('.tag-chip').forEach(function(c) { c.remove(); });
tags.forEach(function(tag) {
var chip = document.createElement('span');
chip.className = 'tag-chip';
var text = document.createElement('span');
text.textContent = tag;
var removeBtn = document.createElement('button');
removeBtn.type = 'button';
removeBtn.className = 'tag-chip-remove';
removeBtn.textContent = '×';
removeBtn.addEventListener('click', function() { removeCallback(tag); });
chip.appendChild(text);
chip.appendChild(removeBtn);
if (input) wrap.insertBefore(chip, input);
else wrap.appendChild(chip);
});
}

// Add Node form tag handlers
function handleAddTagKeydown(event) {
if (event.key === 'Enter') {
event.preventDefault();
var val = event.target.value.trim();
if (!val) return;
if (!addNodeTags.includes(val)) {
addNodeTags.push(val);
renderTagChips(addNodeTags, 'addTagWrap', removeTagFromAddForm);
}
event.target.value = '';
}
}

function removeTagFromAddForm(tag) {
addNodeTags = addNodeTags.filter(function(t) { return t !== tag; });
renderTagChips(addNodeTags, 'addTagWrap', removeTagFromAddForm);
}

// Edit Node modal tag handlers
function handleEditTagKeydown(event) {
if (event.key === 'Enter') {
event.preventDefault();
var val = event.target.value.trim();
if (!val) return;
if (!editNodeTags.includes(val)) {
editNodeTags.push(val);
renderTagChips(editNodeTags, 'editTagWrap', removeTagFromEditForm);
}
event.target.value = '';
}
}

function removeTagFromEditForm(tag) {
editNodeTags = editNodeTags.filter(function(t) { return t !== tag; });
renderTagChips(editNodeTags, 'editTagWrap', removeTagFromEditForm);
}
// ───────────────────────────────────────────────────────────────────────────

// 🌐 Global variables for chains
let availableChains = [];
let currentNodeId = null;

// tracks which node's ··· menu is open
let activeMenuNodeId = null;
let activeMenuIsEnabled = true; // whether that node is currently active

// Open the floating action menu next to the ··· button
function openNodeMenu(event, nodeId) {
event.stopPropagation();
activeMenuNodeId = nodeId;

var btn = event.currentTarget;
var rect = btn.getBoundingClientRect();
var menu = document.getElementById('nodeMenu');

// figure out if this node is currently enabled or disabled
activeMenuIsEnabled = btn.getAttribute('data-active') === '1';

// flip the toggle button label and colour depending on current state
var toggleBtn = document.getElementById('nodeMenuToggle');
if (activeMenuIsEnabled) {
toggleBtn.textContent = '⊘ Disable';
toggleBtn.className = 'node-menu-btn menu-disable';
} else {
toggleBtn.textContent = '✓ Enable';
toggleBtn.className = 'node-menu-btn menu-enable';
}

// measure menu height off-screen, then flip above if not enough space below
menu.style.visibility = 'hidden';
menu.style.display = 'block';
var menuHeight = menu.offsetHeight;
menu.style.visibility = '';

var fitsBelow = (window.innerHeight - rect.bottom) >= menuHeight + 6;
menu.style.top = fitsBelow
  ? (rect.bottom + 6) + 'px'
  : (rect.top - menuHeight - 6) + 'px';
menu.style.left = (rect.right - 160) + 'px';
}

// Close the menu
function closeNodeMenu() {
document.getElementById('nodeMenu').style.display = 'none';
activeMenuNodeId = null;
}

// Menu button handlers — capture the id before closing so it isn't lost
function handleMenuClone() {
var id = activeMenuNodeId;
closeNodeMenu();
cloneNode(id);
}

function handleMenuEdit() {
var id = activeMenuNodeId;
closeNodeMenu();
editNode(id);
}

function handleMenuDelete() {
var id = activeMenuNodeId;
closeNodeMenu();
deleteNode(id);
}

function handleMenuToggleActive() {
var id = activeMenuNodeId;
var enable = !activeMenuIsEnabled; // flip the current state
closeNodeMenu();
toggleNodeActive(id, enable);
}

// Send the enable/disable request to the backend, then refresh the table
async function toggleNodeActive(id, enable) {
try {
var res = await fetch('/nodes/' + id + '/active', {
method: 'PATCH',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ is_active: enable ? 1 : 0 })
});
if (res.ok) {
await fetchStatus();
} else {
var err = await res.json();
alert('❌ Failed to update node: ' + (err.error || 'Unknown error'));
}
} catch (e) {
alert('❌ Error: ' + e.message);
}
}

// Clone a node — pre-fill the Add Node form with the existing node's data
async function cloneNode(id) {
try {
var res = await fetch('/nodes/' + id);
if (!res.ok) { alert('❌ Could not load node data.'); return; }
var node = await res.json();

// Switch to the Add Node tab
switchTab('addNode');

// Pre-fill every field with the existing node's values
document.getElementById('name').value = node.name;
document.getElementById('local').value = node.local_url || '';
document.getElementById('rpcMethod').value = node.custom_method || '';
document.getElementById('params').value = node.custom_params || '[]';
document.getElementById('headers').value = node.custom_headers || '{}';
document.getElementById('responsePath').value = node.custom_response_path || '';
document.getElementById('httpMethod').value = node.custom_http_method || 'POST';
document.getElementById('checkInterval').value = node.check_interval || 60;

// Copy tags to the add form
addNodeTags = Array.isArray(node.tags) ? [...node.tags] : [];
renderTagChips(addNodeTags, 'addTagWrap', removeTagFromAddForm);

// Set the chain dropdown
document.getElementById('chainSelect').value = node.chain_id || '';
searchableSelects.chainSelect?.setValue(String(node.chain_id || ''));

// Populate the remote URL dropdown and pre-select the saved URL
var chain = availableChains.find(function(c) { return c.id === node.chain_id; });
var rpcUrls = chain ? (chain.rpc_urls || []) : [];
populateRemoteDropdown('remote', rpcUrls, node.remote_url || '', 'remoteCustom');

} catch (err) {
alert('❌ Failed to clone node: ' + err.message);
}
}

// Close floating menus when clicking outside
document.addEventListener('click', function(e) {
var nodeMenu = document.getElementById('nodeMenu');
if (nodeMenu && !nodeMenu.contains(e.target)) {
closeNodeMenu();
}
var tagWrapper = document.getElementById('tagDropdownWrapper');
if (tagWrapper && !tagWrapper.contains(e.target)) {
closeTagDropdown();
}
});

// Close node menu on scroll so it doesn't detach from its trigger button
window.addEventListener('scroll', closeNodeMenu, true);
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

  // Sort chains alphabetically by symbol (0-9 first, then A-Z)
  availableChains.sort(function(a, b) {
  var symbolA = a.symbol.toUpperCase();
  var symbolB = b.symbol.toUpperCase();
  if (symbolA < symbolB) return -1;
  if (symbolA > symbolB) return 1;
  return 0;
  });

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
    option.textContent = formatChainLabel(chain.name, chain.symbol);
    option.dataset.chain = JSON.stringify(chain);
    chainSelect.appendChild(option);
  });
  searchableSelects.chainSelect?.refresh();
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
      searchableSelects[selectId]?.refresh();
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
  searchableSelects[selectId]?.refresh();
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
    tags: addNodeTags,
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
    addNodeTags = [];
    renderTagChips(addNodeTags, 'addTagWrap', removeTagFromAddForm);
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
    searchableSelects.editChainSelect?.setValue(String(node.chain_id || ""));
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

    // Populate tags
    editNodeTags = Array.isArray(node.tags) ? [...node.tags] : [];
    renderTagChips(editNodeTags, 'editTagWrap', removeTagFromEditForm);

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
  editNodeTags = [];
}

function populateEditChainDropdown() {
  const select = document.getElementById("editChainSelect");
  if (!select) return;
  select.innerHTML = '<option value="">Select a chain...</option>';
  availableChains.forEach((chain) => {
    const option = document.createElement("option");
    option.value = chain.id;
      option.textContent = formatChainLabel(chain.name, chain.symbol);
    option.dataset.chain = JSON.stringify(chain);
    select.appendChild(option);
  });
  searchableSelects.editChainSelect?.refresh();
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

  // 🔍 Show full error text in a modal
  function showErrorDetail(cell) {
    document.getElementById('errorDetailText').textContent = cell.dataset.error;
    document.getElementById('errorDetailModal').style.display = 'flex';
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
  // Initialise searchable selects for all meaningful dropdowns
  const ssMap = {
  chainSelect: { placeholder: 'Search chains...' },
  editChainSelect: { placeholder: 'Search chains...' },
  remote: { placeholder: 'Search RPC URLs...' },
  editRemote: { placeholder: 'Search RPC URLs...' },
  };
  Object.entries(ssMap).forEach(([id, cfg]) => {
  const el = document.getElementById(id);
  if (el) searchableSelects[id] = new SearchableSelect(el, cfg.placeholder);
  });

  fetchChains(); // Load available chains
  fetchStatus(); // Initial status load
  updateChainsLastSyncLabel();
  setInterval(fetchStatus, 60 * 1000); // re-fetch data every 60s
  setInterval(updateRelativeTimes, 5 * 1000); // update "Xs ago" text every 5s

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
          tags: editNodeTags,
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
