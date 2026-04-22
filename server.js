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
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const options = {
            method: httpMethod,
            signal: controller.signal,
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
          clearTimeout(timeoutId);
          const contentType = response.headers.get("content-type") || "";
          const text = await response.text();

          if (!contentType.includes("application/json")) {
            throw new Error(`Invalid content-type: ${contentType}. Body: ${text}`);
          }

          const data = JSON.parse(text);
          const value = responsePath.split(".").reduce((o, k) => o?.[k], data);
          return parseInt(value, 16);
        } catch (err) {
          if (err.name === 'AbortError') throw new Error('Request timed out after 10s');
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

// POST /chains/sync - Fetch chains from Chainlist and upsert in DB
app.post("/chains/sync", async (_req, res) => {
  try {
    const response = await fetch("https://chainid.network/chains.json");
    if (!response.ok) {
      throw new Error(`Chainlist request failed with ${response.status}`);
    }

    const chainlist = await response.json();
    if (!Array.isArray(chainlist)) {
      throw new Error("Invalid Chainlist payload");
    }

    const existingChains = db.getAllChains();
    const byChainId = new Map(
      existingChains
        .filter((c) => c.chain_id !== null && c.chain_id !== undefined)
        .map((c) => [Number(c.chain_id), c])
    );
    const byName = new Map(
      existingChains.map((c) => [String(c.name || "").toLowerCase(), c])
    );

    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const chain of chainlist) {
      const name = String(chain?.name || "").trim();
      const symbol = String(chain?.nativeCurrency?.symbol || "").trim();
      const chainId = Number(chain?.chainId);
      const rpcUrls = Array.isArray(chain?.rpc)
        ? chain.rpc.filter(
            (url) =>
              typeof url === "string" &&
              url.startsWith("http") &&
              !url.includes("${")
          )
        : [];

      if (!name || !symbol || !Number.isFinite(chainId) || rpcUrls.length === 0) {
        skipped += 1;
        continue;
      }

      const firstExplorer = Array.isArray(chain?.explorers) && chain.explorers.length > 0
        ? chain.explorers[0]
        : null;
      const explorer = String(firstExplorer?.url || "").trim();
      const lowerName = name.toLowerCase();
      const isTestnet =
        lowerName.includes("testnet") ||
        lowerName.includes("sepolia") ||
        lowerName.includes("goerli") ||
        lowerName.includes("devnet");

      const chainData = {
        name,
        symbol,
        chain_id: chainId,
        rpc_method: "eth_blockNumber",
        default_params: "[]",
        response_path: "result",
        http_method: "POST",
        block_time: Number(chain?.averageBlockTime) || 15,
        description: String(chain?.title || ""),
        rpc_urls: rpcUrls,
        explorer,
        is_testnet: isTestnet,
        icon: String(chain?.icon || ""),
        short_name: String(chain?.shortName || "")
      };

      const existing = byChainId.get(chainId) || byName.get(lowerName);
      if (existing) {
        db.updateChain(existing.id, chainData);
        updated += 1;
      } else {
        db.addChain(chainData);
        added += 1;
      }
    }

    res.json({
      success: true,
      added,
      updated,
      skipped,
      totalFromChainlist: chainlist.length,
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to sync chains: " + error.message });
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
