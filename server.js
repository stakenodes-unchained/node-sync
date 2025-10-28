const express = require("express");
const path = require("path");
const fetch = require("node-fetch");
const DatabaseManager = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new DatabaseManager();

app.use(express.static("public"));
app.use(express.json());

// Simple request logger for all API requests
app.use((req, res, next) => {
	const start = Date.now();
	const { method, originalUrl } = req;

	// Capture body safely (only for JSON and non-GET)
	let bodyPreview = '';
	if (method !== 'GET' && req.is('application/json')) {
		try {
			const raw = JSON.stringify(req.body);
			// Truncate to avoid huge logs
			bodyPreview = raw.length > 500 ? raw.slice(0, 500) + '…' : raw;
		} catch (_) {
			bodyPreview = '[unserializable body]';
		}
	}

	res.on('finish', () => {
		const ms = Date.now() - start;
		const status = res.statusCode;
		if (bodyPreview) {
			console.log(`${method} ${originalUrl} ${status} - ${ms}ms body=${bodyPreview}`);
		} else {
			console.log(`${method} ${originalUrl} ${status} - ${ms}ms`);
		}
	});

	next();
});

// GET /
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// GET /status
app.get("/status", async (_req, res) => {
  const nodes = db.getAllNodes();

  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      const {
        name,
        local_url,
        remote_url,
        custom_method,
        custom_params,
        custom_headers,
        custom_response_path,
        custom_http_method,
        default_rpc_method,
        default_params,
        default_response_path,
        default_http_method
        } = node;

        // Use custom values if provided, otherwise use chain defaults
      const method = custom_method || default_rpc_method;
      const params = custom_params ? JSON.parse(custom_params) : JSON.parse(default_params);
      const headers = custom_headers ? JSON.parse(custom_headers) : {};
      const responsePath = custom_response_path || default_response_path;
      const httpMethod = custom_http_method || default_http_method;
      const local = local_url;
      const remote = remote_url;

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

      const result = {
        id: node.id,
        name,
        chain_name: node.chain_name,
        chain_symbol: node.chain_symbol,
        localHeight,
        remoteHeight,
        delay,
        status,
        error: error.trim(),
        lastChecked: new Date(),
      };

      // Save status to history
      try {
        db.addStatusHistory(node.id, {
          localHeight,
          remoteHeight,
          delay,
          status,
          error: error.trim()
        });
      } catch (err) {
        console.error('Failed to save status history:', err);
      }

      return result;
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
  if (!node.name || !node.local_url || !node.remote_url || !node.chain_id) {
    return res.status(400).json({ error: "Missing required fields: name, local_url, remote_url, chain_id" });
  }

  try {
    const result = db.addNode(node);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: "Node with this name already exists." });
    }
    return res.status(500).json({ error: "Failed to add node: " + error.message });
  }
});

// DELETE /delete/:id
app.delete("/delete/:id", (req, res) => {
  try {
    const result = db.deleteNode(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Node not found." });
    }
    res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete node: " + error.message });
  }
});

// PUT /edit/:id
app.put("/edit/:id", (req, res) => {
  try {
    const result = db.updateNode(req.params.id, req.body);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Node not found." });
    }
    res.json({ success: true });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: "Node with this name already exists." });
    }
    return res.status(500).json({ error: "Failed to update node: " + error.message });
  }
});

// Chain management endpoints
// GET /chains
app.get("/chains", (req, res) => {
  try {
    const chains = db.getAllChains();
    res.json(chains);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chains: " + error.message });
  }
});

// POST /chains
app.post("/chains", (req, res) => {
  const chain = req.body;
  if (!chain.name || !chain.symbol || !chain.rpc_method) {
    return res.status(400).json({ error: "Missing required fields: name, symbol, rpc_method" });
  }

  try {
    const result = db.addChain(chain);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: "Chain with this name already exists." });
    }
    return res.status(500).json({ error: "Failed to add chain: " + error.message });
  }
});

// PUT /chains/:id
app.put("/chains/:id", (req, res) => {
  try {
    const result = db.updateChain(req.params.id, req.body);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Chain not found." });
    }
    res.json({ success: true });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: "Chain with this name already exists." });
    }
    return res.status(500).json({ error: "Failed to update chain: " + error.message });
  }
});

// DELETE /chains/:id
app.delete("/chains/:id", (req, res) => {
  try {
    const result = db.deleteChain(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Chain not found." });
    }
    res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// GET /nodes/:id - Get individual node data for editing
app.get("/nodes/:id", (req, res) => {
  try {
    const node = db.getNodeById(req.params.id);
    if (!node) {
      return res.status(404).json({ error: "Node not found." });
    }
    res.json(node);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch node: " + error.message });
  }
});

// GET /nodes/:id/history
app.get("/nodes/:id/history", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = db.getStatusHistory(req.params.id, limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch status history: " + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
