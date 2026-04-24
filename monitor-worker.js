require("dotenv").config();

const fetch = require("node-fetch");
const DatabaseManager = require("./database");

const db = new DatabaseManager();
const TICK_MS = Number(process.env.MONITOR_WORKER_TICK_MS || 5000);
const REQUEST_TIMEOUT_MS = Number(process.env.MONITOR_REQUEST_TIMEOUT_MS || 10000);
const MAX_RESPONSE_BYTES = Number(process.env.MONITOR_MAX_RESPONSE_BYTES || 50000);
const WORKER_LOG_LEVEL = (process.env.MONITOR_WORKER_LOG_LEVEL || "info").toLowerCase();
const HEARTBEAT_EVERY_TICKS = Math.max(Number(process.env.MONITOR_WORKER_HEARTBEAT_EVERY_TICKS || 12), 1);

const nextRunByNodeId = new Map();
const inFlightNodeIds = new Set();
let tickCount = 0;
let totalChecks = 0;
let totalCheckErrors = 0;
let totalPersistErrors = 0;

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function log(level, message, meta = {}) {
  const normalized = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  const current = LOG_LEVELS[WORKER_LOG_LEVEL] ?? LOG_LEVELS.info;
  if (normalized > current) return;
  const timestamp = new Date().toISOString();
  const payload = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const line = `[monitor-worker] ${timestamp} ${level.toUpperCase()} ${message}${payload}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function truncateString(value, maxBytes = MAX_RESPONSE_BYTES) {
  const str = String(value || "");
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;
  return Buffer.from(str, "utf8").subarray(0, maxBytes).toString("utf8");
}

function parseParams(raw, fallback = []) {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function parseHeaders(raw) {
  try {
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

async function probeHeight(url, nodeConfig) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const options = {
      method: nodeConfig.httpMethod,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...nodeConfig.headers
      }
    };

    if (nodeConfig.httpMethod === "POST") {
      options.body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: nodeConfig.method,
        params: nodeConfig.params
      });
    }

    const response = await fetch(url, options);
    const responseMs = Date.now() - startedAt;
    const responseBody = await response.text();
    const headersObj = Object.fromEntries(response.headers.entries());
    const contentType = response.headers.get("content-type") || "";

    let parsed;
    if (contentType.includes("application/json")) {
      parsed = JSON.parse(responseBody);
    } else {
      throw new Error(`Invalid content-type: ${contentType}`);
    }

    const value = String(nodeConfig.responsePath || "result")
      .split(".")
      .reduce((o, k) => o?.[k], parsed);
    const numeric = typeof value === "string" && value.startsWith("0x")
      ? parseInt(value, 16)
      : Number(value);

    if (!Number.isFinite(numeric)) {
      throw new Error("Unable to parse block height");
    }

    return {
      height: numeric,
      statusCode: response.status,
      responseBody: truncateString(responseBody),
      responseHeaders: truncateString(JSON.stringify(headersObj)),
      responseMs,
      error: null
    };
  } catch (error) {
    return {
      height: null,
      statusCode: null,
      responseBody: null,
      responseHeaders: null,
      responseMs: Date.now() - startedAt,
      error: error.name === "AbortError" ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms` : error.message
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runNodeCheck(node) {
  const nodeConfig = {
    method: node.custom_method || node.default_rpc_method,
    params: parseParams(node.custom_params, parseParams(node.default_params, [])),
    headers: parseHeaders(node.custom_headers),
    responsePath: node.custom_response_path || node.default_response_path,
    httpMethod: node.custom_http_method || node.default_http_method
  };

  const [localResult, remoteResult] = await Promise.all([
    probeHeight(node.local_url, nodeConfig),
    probeHeight(node.remote_url, nodeConfig)
  ]);

  let delay = null;
  let status = "Unknown";

  if (localResult.height !== null && remoteResult.height !== null) {
    delay = remoteResult.height - localResult.height;
    status = delay < 5 ? "Healthy" : delay < 20 ? "Degrading" : "Out of Sync";
  } else if (localResult.height === null) {
    status = "Offline";
  }

  const errorMessage = [localResult.error ? `local: ${localResult.error}` : "", remoteResult.error ? `remote: ${remoteResult.error}` : ""]
    .filter(Boolean)
    .join(" | ");
  const hadRequestError = Boolean(localResult.error || remoteResult.error);
  const nextErrorCount = hadRequestError
    ? (Number(node.consecutive_error_count) || 0) + 1
    : 0;

  try {
    db.addStatusHistory(node.id, node.tenant_id, {
      localHeight: localResult.height,
      remoteHeight: remoteResult.height,
      delay,
      status,
      error: errorMessage,
      localStatusCode: localResult.statusCode,
      remoteStatusCode: remoteResult.statusCode,
      localResponseBody: localResult.responseBody,
      remoteResponseBody: remoteResult.responseBody,
      localResponseHeaders: localResult.responseHeaders,
      remoteResponseHeaders: remoteResult.responseHeaders,
      localResponseMs: localResult.responseMs,
      remoteResponseMs: remoteResult.responseMs,
      localError: localResult.error,
      remoteError: remoteResult.error
    });
    db.updateNodeErrorCount(node.id, node.tenant_id, nextErrorCount);
  } catch (persistError) {
    totalPersistErrors += 1;
    log("error", "Failed to persist node check", {
      nodeId: node.id,
      tenantId: node.tenant_id,
      error: persistError.message
    });
    throw persistError;
  }

  totalChecks += 1;
  log("debug", "Node check completed", {
    nodeId: node.id,
    tenantId: node.tenant_id,
    status,
    delay,
    consecutiveErrorCount: nextErrorCount,
    localStatusCode: localResult.statusCode,
    remoteStatusCode: remoteResult.statusCode,
    localResponseMs: localResult.responseMs,
    remoteResponseMs: remoteResult.responseMs
  });
}

async function tick() {
  tickCount += 1;
  const nodes = db.getAllActiveNodesForMonitoring();
  const now = Date.now();
  let scheduledThisTick = 0;

  await Promise.all(nodes.map(async (node) => {
    const nodeId = node.id;
    const intervalMs = Math.max(Number(node.check_interval || 60) * 1000, 10000);
    const nextRun = nextRunByNodeId.get(nodeId) || 0;
    if (now < nextRun || inFlightNodeIds.has(nodeId)) return;

    inFlightNodeIds.add(nodeId);
    nextRunByNodeId.set(nodeId, now + intervalMs);
    scheduledThisTick += 1;
    try {
      await runNodeCheck(node);
    } catch (error) {
      totalCheckErrors += 1;
      log("error", "Worker check failed", {
        nodeId,
        tenantId: node.tenant_id,
        error: error.message
      });
    } finally {
      inFlightNodeIds.delete(nodeId);
    }
  }));

  log("debug", "Worker tick summary", {
    tick: tickCount,
    activeNodes: nodes.length,
    scheduledThisTick,
    inFlight: inFlightNodeIds.size
  });

  if (tickCount % HEARTBEAT_EVERY_TICKS === 0) {
    log("info", "Worker heartbeat", {
      tick: tickCount,
      activeNodes: nodes.length,
      trackedNodes: nextRunByNodeId.size,
      totalChecks,
      totalCheckErrors,
      totalPersistErrors
    });
  }
}

log("info", "Monitor worker started", {
  tickMs: TICK_MS,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  logLevel: WORKER_LOG_LEVEL,
  heartbeatEveryTicks: HEARTBEAT_EVERY_TICKS
});
setInterval(() => {
  tick().catch((error) => log("error", "Worker tick failed", { error: error.message }));
}, TICK_MS);

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});
