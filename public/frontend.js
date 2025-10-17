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

    // 🟢🟡🔴 Color logic based on refined statuss
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
      <td>${node.status}</td>
      <td>${node.localHeight ?? "—"}</td>
      <td>${node.remoteHeight ?? "—"}</td>
      <td>${node.delay ?? "—"}</td>
      <td>${new Date(node.lastChecked).toLocaleString()}</td>
      <td>${node.error ?? ""}</td>
      <td>
        <button onclick="editNode('${node.name}')">✏️ Edit</button>
        <button onclick="deleteNode('${node.name}')">🗑 Delete</button>
      </td>
    `;

    tbody.appendChild(row);
  });
}

// ➕ Handle Add Node form
document.getElementById("nodeForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const node = {
    name: document.getElementById("name").value.trim(),
    httpMethod: document.getElementById("httpMethod").value,
    local: document.getElementById("local").value.trim(),
    remote: document.getElementById("remote").value.trim(),
    method: document.getElementById("rpcMethod").value.trim(),
    params: JSON.parse(document.getElementById("params").value || "[]"),
    headers: JSON.parse(document.getElementById("headers").value || "{}"),
    responsePath: document.getElementById("responsePath").value.trim() || "result",
  };

  const res = await fetch("/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(node),
  });

  if (res.ok) {
    e.target.reset();
    switchTab("dashboard");
    await fetchStatus(); // ✅ Live reload
  } else {
    const err = await res.json();
    alert("❌ Failed to add node: " + (err.error || "Unknown error"));
  }
});

// ❌ Delete node
async function deleteNode(name) {
  if (!confirm(`Delete node "${name}"?`)) return;

  const res = await fetch(`/delete/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

  if (res.ok) {
    await fetchStatus(); // ✅ Live reload
  } else {
    alert("❌ Failed to delete node.");
  }
}

// ✏️ Edit node (populate form for update)
async function editNode(name) {
  const res = await fetch("/status");
  const data = await res.json();
  const node = data.find((n) => n.name === name);

  if (!node) return alert("❌ Node not found.");

  // Populate form
  document.getElementById("name").value = node.name;
  document.getElementById("httpMethod").value = node.httpMethod || "POST";
  document.getElementById("local").value = node.local || "";
  document.getElementById("remote").value = node.remote || "";
  document.getElementById("rpcMethod").value = node.method || "eth_blockNumber";
  document.getElementById("params").value = JSON.stringify(node.params || []);
  document.getElementById("headers").value = JSON.stringify(node.headers || {});
  document.getElementById("responsePath").value = node.responsePath || "result";

  // Switch to Add Node tab
  switchTab("addNode");
  alert("📝 Edit the fields and resubmit to overwrite.");
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

// 🚀 Load data on page load
document.addEventListener("DOMContentLoaded", () => {
  fetchStatus();                          // Initial status load
  setInterval(fetchStatus, 60 * 1000);   // Auto-refresh every 60 seconds
});
