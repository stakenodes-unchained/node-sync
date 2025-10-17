const express = require("express");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const NODES_FILE = "./nodes.json";

app.use(express.static("public"));
app.use(express.json());

// Helper: Read nodes.json
function loadNodes() {
  if (!fs.existsSync(NODES_FILE)) return [];
  return JSON.parse(fs.readFileSync(NODES_FILE));
}

// Helper: Save nodes.json
function saveNodes(nodes) {
  fs.writeFileSync(NODES_FILE, JSON.stringify(nodes, null, 2));
}

// GET /
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// GET /status
app.get("/status", async (_req, res) => {
  const nodes = loadNodes();

  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      const {
        name,
        local,
        remote,
        method,
        params = [],
        headers = {},
        responsePath = "result",
        httpMethod = "POST",
      } = node;

      const fetchHeight = async (url) => {
        try {
          const options = {
            method: httpMethod,
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
          };

          if (httpMethod === "POST") {
            options.body = JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params,
            });
          }

          const response = await fetch(url, options);
          const contentType = response.headers.get("content-type") || "";
          const text = await response.text();

          if (!contentType.includes("application/json")) {
            throw new Error(`Invalid content-type: ${contentType}. Body: ${text}`);
          }

          const data = JSON.parse(text);
          const value = responsePath.split(".").reduce((o, k) => o?.[k], data);
          return parseInt(value, 16);
        } catch (err) {
          throw new Error(err.message);
        }
      };

      let localHeight = null;
      let remoteHeight = null;
      let delay = null;
      let status = "Unknown";
      let error = "";

      try {
        localHeight = await fetchHeight(local);
      } catch (err) {
        error += `local node error: ${err.message} `;
      }

      try {
        remoteHeight = await fetchHeight(remote);
      } catch (err) {
        error += `remote node error: ${err.message}`;
      }

	if (localHeight !== null && remoteHeight !== null) {
	  delay = remoteHeight - localHeight;

	  if (delay < 5) {
	    status = "Healthy";
	  } else if (delay < 20) {
	    status = "Degrading";
	  } else {
	    status = "Out of Sync";
	  }
	} else if (localHeight === null) {
	  status = "Offline";
	} else {
	  status = "Unknown";
	}

      return {
        name,
        localHeight,
        remoteHeight,
        delay,
        status,
        error: error.trim(),
        lastChecked: new Date(),
      };
    })
  );

  const sorted = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json(sorted);
});

// POST /add
app.post("/add", (req, res) => {
  const node = req.body;
  if (!node.name || !node.local || !node.remote) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const nodes = loadNodes();
  const existing = nodes.find((n) => n.name === node.name);
  if (existing) {
    return res.status(400).json({ error: "Node already exists." });
  }

  nodes.push(node);
  saveNodes(nodes);
  res.json({ success: true });
});

// DELETE /delete/:name
app.delete("/delete/:name", (req, res) => {
  const nodes = loadNodes();
  const updated = nodes.filter((n) => n.name !== req.params.name);
  if (updated.length === nodes.length) {
    return res.status(404).json({ error: "Node not found." });
  }

  saveNodes(updated);
  res.json({ success: true });
});

// PUT /edit/:name
app.put("/edit/:name", (req, res) => {
  const nodes = loadNodes();
  const index = nodes.findIndex((n) => n.name === req.params.name);
  if (index === -1) {
    return res.status(404).json({ error: "Node not found." });
  }

  nodes[index] = req.body;
  saveNodes(nodes);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
