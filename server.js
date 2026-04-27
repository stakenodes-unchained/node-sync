require("dotenv").config();

const express = require("express");
const path = require("path");
const fetch = require("node-fetch");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");
const crypto = require("crypto");
const DatabaseManager = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-me";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRO_SUBSCRIPTION_PRICE_ID = process.env.STRIPE_PRO_SUBSCRIPTION_PRICE_ID;
const STRIPE_PRO_ONE_TIME_PRICE_ID = process.env.STRIPE_PRO_ONE_TIME_PRICE_ID;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const db = new DatabaseManager();

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toIso(date) {
  return new Date(date).toISOString();
}

function transitionSubscriptionLifecycle(sub) {
  const now = new Date();
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const graceEnds = sub.grace_ends_at ? new Date(sub.grace_ends_at) : null;
  const retentionDeleteAt = sub.retention_delete_at ? new Date(sub.retention_delete_at) : null;

  if (sub.lifecycle_state === "deleted") {
    return db.getSubscriptionByTenantId(sub.tenant_id);
  }

  if (periodEnd && now > periodEnd && sub.lifecycle_state === "active") {
    const graceEnd = graceEnds || addDays(periodEnd, 7);
    db.upsertSubscriptionByTenantId(sub.tenant_id, {
      status: "grace",
      lifecycleState: "grace",
      graceEndsAt: toIso(graceEnd)
    });
    return db.getSubscriptionByTenantId(sub.tenant_id);
  }

  if (graceEnds && now > graceEnds && (sub.lifecycle_state === "active" || sub.lifecycle_state === "grace")) {
    const blockedAt = now;
    const retentionAt = addMonths(blockedAt, 2);
    db.upsertSubscriptionByTenantId(sub.tenant_id, {
      status: "blocked",
      lifecycleState: "blocked",
      blockedAt: toIso(blockedAt),
      retentionDeleteAt: toIso(retentionAt),
      plan: "free"
    });
    return db.getSubscriptionByTenantId(sub.tenant_id);
  }

  if (retentionDeleteAt && now > retentionDeleteAt && sub.lifecycle_state === "blocked") {
    db.anonymizeTenantData(sub.tenant_id);
    db.deleteTenantOperationalData(sub.tenant_id);
    db.upsertSubscriptionByTenantId(sub.tenant_id, {
      status: "deleted",
      lifecycleState: "deleted",
      plan: "free"
    });
    return db.getSubscriptionByTenantId(sub.tenant_id);
  }

  return sub;
}

function getTenantPlan(tenantId) {
  const sub = db.getSubscriptionByTenantId(tenantId);
  if (!sub) {
    db.createFreeSubscription(tenantId);
    return db.getSubscriptionByTenantId(tenantId);
  }
  return transitionSubscriptionLifecycle(sub);
}

function requireMonitoringAccess(req, res, next) {
  return verifyAndEnforceMonitoringAccess(req, res, next);
}

async function syncTenantBillingFromStripe(tenantId) {
  const localSub = db.getSubscriptionByTenantId(tenantId);
  if (!stripe || !localSub?.stripe_customer_id) {
    return getTenantPlan(tenantId);
  }

  try {
    if (localSub.billing_mode === "subscription") {
      const subscriptions = await stripe.subscriptions.list({
        customer: localSub.stripe_customer_id,
        status: "all",
        limit: 10
      });

      const activeSub = subscriptions.data.find((s) =>
        ["active", "trialing", "past_due"].includes(s.status)
      );

      if (activeSub) {
        const periodStart = new Date((activeSub.current_period_start || 0) * 1000);
        const periodEnd = new Date((activeSub.current_period_end || 0) * 1000);
        const graceEnd = addDays(periodEnd, 7);
        db.upsertSubscriptionByTenantId(tenantId, {
          billingMode: "subscription",
          plan: "pro",
          status: activeSub.status,
          lifecycleState: "active",
          stripeSubscriptionId: activeSub.id,
          currentPeriodStart: toIso(periodStart),
          currentPeriodEnd: toIso(periodEnd),
          graceEndsAt: toIso(graceEnd),
          blockedAt: null,
          retentionDeleteAt: null
        });
      }
    } else {
      const sessions = await stripe.checkout.sessions.list({
        customer: localSub.stripe_customer_id,
        limit: 25
      });

      const paidManualSessions = sessions.data
        .filter((s) => s.payment_status === "paid" && (s.metadata?.billingMode || "manual_monthly") === "manual_monthly")
        .sort((a, b) => b.created - a.created);

      const latest = paidManualSessions[0];
      if (latest) {
        const periodStart = new Date(latest.created * 1000);
        const periodEnd = addMonths(periodStart, 1);
        const graceEnd = addDays(periodEnd, 7);
        db.activatePaidPeriod(tenantId, toIso(periodStart), toIso(periodEnd), toIso(graceEnd));
      }
    }
  } catch (error) {
    console.error("Stripe access verification failed:", error.message);
  }

  return getTenantPlan(tenantId);
}

async function verifyAndEnforceMonitoringAccess(req, res, next) {
  const sub = await syncTenantBillingFromStripe(req.auth.tenantId);
  const blockedStates = new Set(["blocked", "retention", "deleted"]);
  if (blockedStates.has(sub.lifecycle_state)) {
    return res.status(403).json({
      error: "Monitoring access blocked due to unpaid billing. Complete monthly payment to resume.",
      lifecycleState: sub.lifecycle_state,
      retentionDeleteAt: sub.retention_delete_at || null
    });
  }
  return next();
}

function applyManualMonthlySession(session) {
  const tenantUid = String(session?.metadata?.tenantId || "");
  const billingMode = session?.metadata?.billingMode || "manual_monthly";
  if (!tenantUid || billingMode !== "manual_monthly") return false;
  const tenant = db.getTenantByUid(tenantUid);
  if (!tenant?.id) return false;
  const tenantId = tenant.id;

  const paidAt = new Date();
  const periodStart = paidAt;
  const periodEnd = addMonths(periodStart, 1);
  const graceEnd = addDays(periodEnd, 7);

  db.recordPayment({
    tenantId,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent || null,
    amount: session.amount_total || 0,
    currency: session.currency || "usd",
    status: "paid",
    paidAt: toIso(paidAt),
    periodStart: toIso(periodStart),
    periodEnd: toIso(periodEnd)
  });

  db.activatePaidPeriod(tenantId, toIso(periodStart), toIso(periodEnd), toIso(graceEnd));
  return true;
}

app.post("/billing/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send("Stripe not configured");
  }

  const signature = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      applyManualMonthlySession(session);
    }

    if (event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;
      applyManualMonthlySession(session);
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const member = db.db
        .prepare("SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1")
        .get(customerId);
      if (member) {
        const periodStart = new Date((subscription.current_period_start || 0) * 1000);
        const periodEnd = new Date((subscription.current_period_end || 0) * 1000);
        const graceEnd = addDays(periodEnd, 7);
        db.upsertSubscriptionByTenantId(member.tenant_id, {
          billingMode: "subscription",
          plan: "pro",
          status: subscription.status === "active" ? "active" : subscription.status,
          lifecycleState: subscription.status === "active" ? "active" : "grace",
          stripeSubscriptionId: subscription.id,
          currentPeriodStart: toIso(periodStart),
          currentPeriodEnd: toIso(periodEnd),
          graceEndsAt: toIso(graceEnd),
          blockedAt: null,
          retentionDeleteAt: null
        });
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const member = db.db
        .prepare("SELECT tenant_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1")
        .get(subscription.id);
      if (member) {
        const now = new Date();
        db.upsertSubscriptionByTenantId(member.tenant_id, {
          billingMode: "subscription",
          plan: "free",
          status: "canceled",
          lifecycleState: "blocked",
          blockedAt: toIso(now),
          retentionDeleteAt: toIso(addMonths(now, 2))
        });
      }
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
  }

  return res.json({ received: true });
});

app.use(express.static("public"));
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${method} ${originalUrl} ${res.statusCode} - ${ms}ms`);
  });
  next();
});

function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const membership = db.getMembershipByUserId(decoded.userId);
    if (!membership) return res.status(401).json({ error: "Unauthorized" });

    req.auth = {
      userId: decoded.userId,
      tenantId: membership.tenant_id,
      tenantUid: membership.tenant_uid,
      role: membership.role,
      email: membership.email,
      accountType: membership.account_type,
      organizationName: membership.organization_name
    };
    next();
  } catch (_error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function enforceNodeLimit(tenantId) {
  const sub = getTenantPlan(tenantId);
  const count = db.countTenantNodes(tenantId);

  const hardLimit = sub.plan === "free" ? 5 : Number.MAX_SAFE_INTEGER;
  if (count >= hardLimit) {
    return { allowed: false, message: "Free plan allows monitoring up to 5 nodes." };
  }

  if (sub.plan === "pro" && count >= sub.node_soft_limit) {
    return {
      allowed: false,
      message: `You reached your soft limit (${sub.node_soft_limit}). Contact support to increase it.`
    };
  }

  return { allowed: true };
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.post("/auth/register", async (req, res) => {
  const { email, password, accountType, organizationName } = req.body;
  if (!email || !password || !accountType) {
    return res.status(400).json({ error: "email, password, accountType are required." });
  }
  if (!["business", "individual"].includes(accountType)) {
    return res.status(400).json({ error: "accountType must be business or individual." });
  }
  if (accountType === "business" && !organizationName) {
    return res.status(400).json({ error: "organizationName is required for business accounts." });
  }

  try {
    const existing = db.getUserByEmail(email);
    if (existing) return res.status(400).json({ error: "Email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const tx = db.db.transaction(() => {
      const user = db.createUser({ email, passwordHash });
      const userId = user.lastInsertRowid;
      const tenant = db.createTenant({
        tenantUid: `tenant_${crypto.randomUUID().replace(/-/g, "")}`,
        accountType,
        organizationName: accountType === "business" ? organizationName : null,
        ownerUserId: userId
      });
      const tenantId = tenant.lastInsertRowid;
      db.addMembership({ userId, tenantId, role: "owner" });
      db.createFreeSubscription(tenantId);
      return { userId, tenantId };
    });

    const created = tx();
    const token = createToken(created.userId);
    return res.json({ token });
  } catch (error) {
    return res.status(500).json({ error: `Registration failed: ${error.message}` });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password are required." });

  try {
    const user = db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials." });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials." });
    return res.json({ token: createToken(user.id) });
  } catch (error) {
    return res.status(500).json({ error: `Login failed: ${error.message}` });
  }
});

app.post("/auth/logout", (_req, res) => res.json({ success: true }));

app.get("/auth/me", requireAuth, (req, res) => {
  const sub = getTenantPlan(req.auth.tenantId);
  res.json({
    user: { id: req.auth.userId, email: req.auth.email },
    tenant: {
      id: req.auth.tenantUid,
      role: req.auth.role,
      accountType: req.auth.accountType,
      organizationName: req.auth.organizationName
    },
    subscription: sub
  });
});

app.get("/plans", (_req, res) => {
  res.json([
    { id: "free", name: "Free", priceUsdMonthly: 0, nodeLimit: 5 },
    { id: "pro", name: "Pro", priceUsdMonthly: 10, nodeLimit: "Unlimited", softLimit: 100 }
  ]);
});

app.get("/billing/subscription", requireAuth, (req, res) => {
  res.json(getTenantPlan(req.auth.tenantId));
});

app.get("/billing/verify-access", requireAuth, async (req, res) => {
  const sub = await syncTenantBillingFromStripe(req.auth.tenantId);
  const blockedStates = new Set(["blocked", "retention", "deleted"]);
  return res.json({
    hasAccess: !blockedStates.has(sub.lifecycle_state),
    lifecycleState: sub.lifecycle_state,
    subscription: sub,
    source: "stripe_api"
  });
});

app.post("/billing/override-soft-limit", requireAuth, (req, res) => {
  if (req.auth.role !== "owner") return res.status(403).json({ error: "Only owner can update limits." });
  const { nodeSoftLimit } = req.body;
  if (!Number.isInteger(nodeSoftLimit) || nodeSoftLimit < 1) {
    return res.status(400).json({ error: "nodeSoftLimit must be a positive integer." });
  }
  const result = db.updateTenantNodeSoftLimit(req.auth.tenantId, nodeSoftLimit);
  if (!result.changes) return res.status(404).json({ error: "Subscription not found." });
  return res.json({ success: true });
});

app.post("/billing/checkout-session", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(400).json({ error: "Stripe checkout is not configured." });
  }

  try {
    const billingMode = req.body?.billingMode === "subscription" ? "subscription" : "manual_monthly";
    const existingSub = db.getSubscriptionByTenantId(req.auth.tenantId);
    let customerId = existingSub?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.auth.email,
        metadata: { tenantId: String(req.auth.tenantUid) }
      });
      customerId = customer.id;
    }

    db.upsertSubscriptionByTenantId(req.auth.tenantId, { stripeCustomerId: customerId });

    const selectedPriceId =
      billingMode === "subscription" ? STRIPE_PRO_SUBSCRIPTION_PRICE_ID : STRIPE_PRO_ONE_TIME_PRICE_ID;

    if (!selectedPriceId) {
      return res.status(400).json({
        error:
          billingMode === "subscription"
            ? "Missing STRIPE_PRO_SUBSCRIPTION_PRICE_ID for subscription checkout."
            : "Missing STRIPE_PRO_ONE_TIME_PRICE_ID for one-time checkout."
      });
    }

    const checkoutPayload = {
      mode: billingMode === "subscription" ? "subscription" : "payment",
      customer: customerId,
      line_items: [{ price: selectedPriceId, quantity: 1 }],
      success_url: `${APP_BASE_URL}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/?billing=cancel`,
      payment_method_types: billingMode === "subscription" ? ["card", "us_bank_account"] : ["crypto"],
      metadata: { tenantId: String(req.auth.tenantUid), billingMode }
    };

    const session = await stripe.checkout.sessions.create(checkoutPayload);

    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: `Failed to create checkout session: ${error.message}` });
  }
});

app.post("/billing/confirm-session", requireAuth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: "Stripe is not configured." });
  const sessionId = String(req.body?.sessionId || "");
  if (!sessionId) return res.status(400).json({ error: "sessionId is required." });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const tenantUid = String(session?.metadata?.tenantId || "");
    if (tenantUid !== String(req.auth.tenantUid)) {
      return res.status(403).json({ error: "Session does not belong to this tenant." });
    }
    if (session.payment_status === "paid") {
      const applied = applyManualMonthlySession(session);
      return res.json({ success: true, applied });
    }
    return res.json({ success: true, applied: false, paymentStatus: session.payment_status });
  } catch (error) {
    return res.status(500).json({ error: `Failed to confirm checkout session: ${error.message}` });
  }
});

app.post("/billing/portal", requireAuth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: "Stripe is not configured." });
  const sub = db.getSubscriptionByTenantId(req.auth.tenantId);
  let customerId = sub?.stripe_customer_id;

  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.auth.email,
        metadata: { tenantId: String(req.auth.tenantUid) }
      });
      customerId = customer.id;
      db.upsertSubscriptionByTenantId(req.auth.tenantId, { stripeCustomerId: customerId });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: APP_BASE_URL
    });
    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: `Failed to create billing portal session: ${error.message}` });
  }
});

app.get("/status", requireAuth, requireMonitoringAccess, (req, res) => {
  try {
    const snapshot = db.getLatestStatusByTenant(req.auth.tenantId);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch latest status snapshot: " + error.message });
  }
});

// PATCH /nodes/:id/active — enable or disable a node
app.patch("/nodes/:id/active", (req, res) => {
  try {
  const result = db.setNodeActive(req.params.id, req.body.is_active);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Node not found." });
  }
    res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update node: " + error.message });
  }
});

// POST /add
app.post("/add", requireAuth, requireMonitoringAccess, (req, res) => {
  const node = req.body;
  if (!node.name || !node.local_url || !node.remote_url || !node.chain_id) {
    return res.status(400).json({ error: "Missing required fields: name, local_url, remote_url, chain_id" });
  }

  try {
    const limit = enforceNodeLimit(req.auth.tenantId);
    if (!limit.allowed) return res.status(403).json({ error: limit.message });
    const result = db.addNode(node, req.auth.tenantId);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: "Node with this name already exists." });
    }
    return res.status(500).json({ error: "Failed to add node: " + error.message });
  }
});

// DELETE /delete/:id
app.delete("/delete/:id", requireAuth, requireMonitoringAccess, (req, res) => {
  try {
    const result = db.deleteNode(req.params.id, req.auth.tenantId);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Node not found." });
    }
    res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete node: " + error.message });
  }
});

// PUT /edit/:id
app.put("/edit/:id", requireAuth, requireMonitoringAccess, (req, res) => {
  try {
    const result = db.updateNode(req.params.id, req.auth.tenantId, req.body);
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
app.post("/chains/sync", requireAuth, async (_req, res) => {
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
app.post("/chains", requireAuth, (req, res) => {
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
app.put("/chains/:id", requireAuth, (req, res) => {
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
app.delete("/chains/:id", requireAuth, (req, res) => {
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
app.get("/nodes/:id", requireAuth, requireMonitoringAccess, (req, res) => {
  try {
    const node = db.getNodeById(req.params.id, req.auth.tenantId);
    if (!node) {
      return res.status(404).json({ error: "Node not found." });
    }
    res.json(node);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch node: " + error.message });
  }
});

// GET /nodes/:id/history
app.get("/nodes/:id/history", requireAuth, requireMonitoringAccess, (req, res) => {
  try {
    const nodeId = Number(req.params.id);
    const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;
    const range = String(req.query.range || "").toLowerCase();
    const now = new Date();
    let from;
    let to = req.query.to ? new Date(req.query.to) : now;

    if (req.query.from) {
      from = new Date(req.query.from);
    } else {
      const map = { "1h": 1, "6h": 6, "12h": 12, "1d": 24, "7d": 24 * 7 };
      const hours = map[range] || 1;
      from = new Date(now.getTime() - hours * 60 * 60 * 1000);
    }

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return res.status(400).json({ error: "Invalid time range." });
    }

    const maxWindowMs = 31 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maxWindowMs) {
      return res.status(400).json({ error: "Range too large. Max supported range is 31 days." });
    }

    const history = db.getStatusHistoryByRange({
      nodeId,
      tenantId: req.auth.tenantId,
      from: from.toISOString(),
      to: to.toISOString(),
      limit,
      offset
    });
    const total = db.countStatusHistoryByRange({
      nodeId,
      tenantId: req.auth.tenantId,
      from: from.toISOString(),
      to: to.toISOString()
    });

    res.json({
      items: history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        hasNextPage: offset + history.length < total,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch status history: " + error.message });
  }
});

  // GET /tags — return all unique tags across all nodes
  app.get("/tags", (req, res) => {
    try {
    const tags = db.getAllTags();
    res.json(tags);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tags: " + error.message });
    }
  });

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
