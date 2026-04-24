const Database = require('better-sqlite3');

class DatabaseManager {
  constructor(dbPath = './sync_checker.db') {
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  init() {
    // Create tables if they don't exist
    this.createTables();
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS supported_chains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        symbol TEXT NOT NULL,
        rpc_method TEXT NOT NULL,
        default_params TEXT DEFAULT '[]',
        response_path TEXT DEFAULT 'result',
        http_method TEXT DEFAULT 'POST',
        block_time REAL DEFAULT 15,
        description TEXT,
        chain_id INTEGER,
        rpc_urls TEXT DEFAULT '[]',
        explorer TEXT,
        is_testnet BOOLEAN DEFAULT 0,
        icon TEXT,
        short_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_uid TEXT UNIQUE,
        account_type TEXT NOT NULL CHECK(account_type IN ('business', 'individual')),
        organization_name TEXT,
        owner_user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users (id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tenant_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, tenant_id),
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL UNIQUE,
        plan TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'active',
        billing_mode TEXT NOT NULL DEFAULT 'manual_monthly',
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        node_soft_limit INTEGER NOT NULL DEFAULT 100,
        current_period_start DATETIME,
        current_period_end DATETIME,
        grace_ends_at DATETIME,
        blocked_at DATETIME,
        retention_delete_at DATETIME,
        last_payment_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        stripe_checkout_session_id TEXT UNIQUE,
        stripe_payment_intent_id TEXT,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        status TEXT NOT NULL,
        paid_at DATETIME,
        period_start DATETIME,
        period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        name TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        local_url TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        custom_method TEXT,
        custom_params TEXT DEFAULT '[]',
        custom_headers TEXT DEFAULT '{}',
        custom_response_path TEXT,
        custom_http_method TEXT,
        consecutive_error_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chain_id) REFERENCES supported_chains (id),
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        node_id INTEGER NOT NULL,
        local_height INTEGER,
        remote_height INTEGER,
        delay INTEGER,
        status TEXT NOT NULL,
        error_message TEXT,
        local_status_code INTEGER,
        remote_status_code INTEGER,
        local_response_body TEXT,
        remote_response_body TEXT,
        local_response_headers TEXT,
        remote_response_headers TEXT,
        local_response_ms INTEGER,
        remote_response_ms INTEGER,
        local_error TEXT,
        remote_error TEXT,
        checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants (id),
        FOREIGN KEY (node_id) REFERENCES nodes (id)
      )
    `);

    // Migrations for existing installations.
    try {
      this.db.exec('ALTER TABLE nodes ADD COLUMN check_interval INTEGER DEFAULT 60');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE nodes ADD COLUMN tenant_id INTEGER');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE nodes ADD COLUMN consecutive_error_count INTEGER DEFAULT 0');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE tenants ADD COLUMN tenant_uid TEXT');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec("ALTER TABLE subscriptions ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'manual_monthly'");
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec("ALTER TABLE subscriptions ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'");
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN current_period_start DATETIME');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN current_period_end DATETIME');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN grace_ends_at DATETIME');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN blocked_at DATETIME');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN retention_delete_at DATETIME');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN last_payment_at DATETIME');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN tenant_id INTEGER');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN local_status_code INTEGER');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN remote_status_code INTEGER');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN local_response_body TEXT');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN remote_response_body TEXT');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN local_response_headers TEXT');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN remote_response_headers TEXT');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN local_response_ms INTEGER');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN remote_response_ms INTEGER');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN local_error TEXT');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
    try {
      this.db.exec('ALTER TABLE node_status_history ADD COLUMN remote_error TEXT');
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_tenant_name ON nodes(tenant_id, name);
      CREATE INDEX IF NOT EXISTS idx_nodes_chain_id ON nodes(chain_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_active ON nodes(is_active);
      CREATE INDEX IF NOT EXISTS idx_nodes_tenant_id ON nodes(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_status_history_node_id ON node_status_history(node_id);
      CREATE INDEX IF NOT EXISTS idx_status_history_checked_at ON node_status_history(checked_at);
      CREATE INDEX IF NOT EXISTS idx_status_history_tenant_node_checked ON node_status_history(tenant_id, node_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_status_history_tenant_checked ON node_status_history(tenant_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
      CREATE INDEX IF NOT EXISTS idx_memberships_tenant_id ON memberships(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_tenant_uid ON tenants(tenant_uid);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_lifecycle_state ON subscriptions(lifecycle_state);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_retention_delete_at ON subscriptions(retention_delete_at);
      CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    `);

    // Backfill safety for old rows created before monthly lifecycle fields.
    this.db.exec(`
      UPDATE subscriptions
      SET
        billing_mode = COALESCE(billing_mode, 'manual_monthly'),
        lifecycle_state = COALESCE(lifecycle_state, 'active')
    `);
    this.db.exec(`
      UPDATE subscriptions
      SET
        current_period_start = COALESCE(current_period_start, CURRENT_TIMESTAMP),
        current_period_end = COALESCE(current_period_end, DATETIME(CURRENT_TIMESTAMP, '+30 days')),
        grace_ends_at = COALESCE(grace_ends_at, DATETIME(CURRENT_TIMESTAMP, '+37 days'))
      WHERE plan = 'pro'
    `);
    this.db.exec(`
      UPDATE tenants
      SET tenant_uid = COALESCE(tenant_uid, 'tenant_' || lower(hex(randomblob(16))))
    `);
    this.db.exec(`
      UPDATE node_status_history
      SET tenant_id = (
        SELECT n.tenant_id
        FROM nodes n
        WHERE n.id = node_status_history.node_id
      )
      WHERE tenant_id IS NULL
    `);
  }

  // Chain management methods
  addChain(chainData) {
    // Validate and sanitize data
    const sanitizedData = {
      name: String(chainData.name || ''),
      symbol: String(chainData.symbol || ''),
      rpc_method: String(chainData.rpc_method || ''),
      default_params: String(chainData.default_params || '[]'),
      response_path: String(chainData.response_path || 'result'),
      http_method: String(chainData.http_method || 'POST'),
      block_time: Number(chainData.block_time || 15),
      description: String(chainData.description || ''),
      chain_id: chainData.chain_id ? Number(chainData.chain_id) : null,
      rpc_urls: JSON.stringify(chainData.rpc_urls || []),
      explorer: String(chainData.explorer || ''),
      is_testnet: chainData.is_testnet ? 1 : 0,
      icon: String(chainData.icon || ''),
      short_name: String(chainData.short_name || '')
    };

    const stmt = this.db.prepare(`
      INSERT INTO supported_chains (name, symbol, rpc_method, default_params, response_path, http_method, block_time, description, chain_id, rpc_urls, explorer, is_testnet, icon, short_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      sanitizedData.name,
      sanitizedData.symbol,
      sanitizedData.rpc_method,
      sanitizedData.default_params,
      sanitizedData.response_path,
      sanitizedData.http_method,
      sanitizedData.block_time,
      sanitizedData.description,
      sanitizedData.chain_id,
      sanitizedData.rpc_urls,
      sanitizedData.explorer,
      sanitizedData.is_testnet,
      sanitizedData.icon,
      sanitizedData.short_name
    );
  }

  getAllChains() {
    const stmt = this.db.prepare('SELECT * FROM supported_chains ORDER BY name');
    const chains = stmt.all();
    
    // Parse JSON fields that are stored as strings
    return chains.map(chain => ({
      ...chain,
      rpc_urls: chain.rpc_urls ? JSON.parse(chain.rpc_urls) : [],
      is_testnet: Boolean(chain.is_testnet)
    }));
  }

  getChainById(id) {
    const stmt = this.db.prepare('SELECT * FROM supported_chains WHERE id = ?');
    const chain = stmt.get(id);
    
    if (!chain) return null;
    
    // Parse JSON fields that are stored as strings
    return {
      ...chain,
      rpc_urls: chain.rpc_urls ? JSON.parse(chain.rpc_urls) : [],
      is_testnet: Boolean(chain.is_testnet)
    };
  }

  updateChain(id, chainData) {
    const stmt = this.db.prepare(`
      UPDATE supported_chains 
      SET name = ?, symbol = ?, rpc_method = ?, default_params = ?, response_path = ?, 
          http_method = ?, block_time = ?, description = ?, chain_id = ?, rpc_urls = ?, 
          explorer = ?, is_testnet = ?, icon = ?, short_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    return stmt.run(
      chainData.name,
      chainData.symbol,
      chainData.rpc_method,
      chainData.default_params || '[]',
      chainData.response_path || 'result',
      chainData.http_method || 'POST',
      chainData.block_time || 15,
      chainData.description || '',
      chainData.chain_id || null,
      JSON.stringify(chainData.rpc_urls || []),
      chainData.explorer || '',
      chainData.is_testnet ? 1 : 0, // Convert boolean to integer
      chainData.icon || '',
      chainData.short_name || '',
      id
    );
  }

  deleteChain(id) {
    // Check if any nodes are using this chain
    const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE chain_id = ?').get(id);
    if (nodeCount.count > 0) {
      throw new Error('Cannot delete chain: nodes are still using this chain');
    }

    const stmt = this.db.prepare('DELETE FROM supported_chains WHERE id = ?');
    return stmt.run(id);
  }

  // Node management methods
  createUser({ email, passwordHash }) {
    const stmt = this.db.prepare(`
      INSERT INTO users (email, password_hash)
      VALUES (?, ?)
    `);
    return stmt.run(email.toLowerCase().trim(), passwordHash);
  }

  getUserByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  }

  getUserById(userId) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  }

  createTenant({ tenantUid, accountType, organizationName, ownerUserId }) {
    const stmt = this.db.prepare(`
      INSERT INTO tenants (tenant_uid, account_type, organization_name, owner_user_id)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(tenantUid, accountType, organizationName || null, ownerUserId);
  }

  addMembership({ userId, tenantId, role = 'owner' }) {
    const stmt = this.db.prepare(`
      INSERT INTO memberships (user_id, tenant_id, role)
      VALUES (?, ?, ?)
    `);
    return stmt.run(userId, tenantId, role);
  }

  createFreeSubscription(tenantId) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO subscriptions (
        tenant_id, plan, status, billing_mode, lifecycle_state, node_soft_limit
      )
      VALUES (?, 'free', 'active', 'manual_monthly', 'active', 100)
    `);
    return stmt.run(tenantId);
  }

  getMembershipByUserId(userId) {
    const stmt = this.db.prepare(`
      SELECT m.user_id, m.tenant_id, m.role, t.account_type, t.organization_name, u.email
      , t.tenant_uid
      FROM memberships m
      JOIN tenants t ON t.id = m.tenant_id
      JOIN users u ON u.id = m.user_id
      WHERE m.user_id = ?
      ORDER BY m.id ASC
      LIMIT 1
    `);
    return stmt.get(userId);
  }

  getTenantByUid(tenantUid) {
    return this.db.prepare('SELECT * FROM tenants WHERE tenant_uid = ?').get(tenantUid);
  }

  getSubscriptionByTenantId(tenantId) {
    const stmt = this.db.prepare('SELECT * FROM subscriptions WHERE tenant_id = ?');
    return stmt.get(tenantId);
  }

  upsertSubscriptionByTenantId(tenantId, data) {
    const existing = this.getSubscriptionByTenantId(tenantId);
    if (!existing) {
      const stmt = this.db.prepare(`
        INSERT INTO subscriptions (
          tenant_id, plan, status, billing_mode, lifecycle_state, stripe_customer_id, stripe_subscription_id,
          node_soft_limit, current_period_start, current_period_end, grace_ends_at, blocked_at,
          retention_delete_at, last_payment_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        tenantId,
        data.plan || 'free',
        data.status || 'active',
        data.billingMode || 'manual_monthly',
        data.lifecycleState || 'active',
        data.stripeCustomerId || null,
        data.stripeSubscriptionId || null,
        Number.isFinite(data.nodeSoftLimit) ? data.nodeSoftLimit : 100,
        data.currentPeriodStart || null,
        data.currentPeriodEnd || null,
        data.graceEndsAt || null,
        data.blockedAt || null,
        data.retentionDeleteAt || null,
        data.lastPaymentAt || null
      );
    }

    const stmt = this.db.prepare(`
      UPDATE subscriptions
      SET
        plan = ?,
        status = ?,
        billing_mode = ?,
        lifecycle_state = ?,
        stripe_customer_id = ?,
        stripe_subscription_id = ?,
        node_soft_limit = ?,
        current_period_start = ?,
        current_period_end = ?,
        grace_ends_at = ?,
        blocked_at = ?,
        retention_delete_at = ?,
        last_payment_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
    `);
    return stmt.run(
      data.plan || existing.plan,
      data.status || existing.status,
      data.billingMode || existing.billing_mode || 'manual_monthly',
      data.lifecycleState || existing.lifecycle_state || 'active',
      data.stripeCustomerId ?? existing.stripe_customer_id,
      data.stripeSubscriptionId ?? existing.stripe_subscription_id,
      Number.isFinite(data.nodeSoftLimit) ? data.nodeSoftLimit : existing.node_soft_limit,
      data.currentPeriodStart ?? existing.current_period_start,
      data.currentPeriodEnd ?? existing.current_period_end,
      data.graceEndsAt ?? existing.grace_ends_at,
      data.blockedAt ?? existing.blocked_at,
      data.retentionDeleteAt ?? existing.retention_delete_at,
      data.lastPaymentAt ?? existing.last_payment_at,
      tenantId
    );
  }

  recordPayment(data) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO payments (
        tenant_id, stripe_checkout_session_id, stripe_payment_intent_id, amount, currency, status,
        paid_at, period_start, period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      data.tenantId,
      data.checkoutSessionId || null,
      data.paymentIntentId || null,
      Number(data.amount || 0),
      data.currency || 'usd',
      data.status || 'paid',
      data.paidAt || null,
      data.periodStart || null,
      data.periodEnd || null
    );
  }

  activatePaidPeriod(tenantId, periodStartIso, periodEndIso, graceEndsIso) {
    return this.upsertSubscriptionByTenantId(tenantId, {
      plan: 'pro',
      status: 'active',
      billingMode: 'manual_monthly',
      lifecycleState: 'active',
      currentPeriodStart: periodStartIso,
      currentPeriodEnd: periodEndIso,
      graceEndsAt: graceEndsIso,
      blockedAt: null,
      retentionDeleteAt: null,
      lastPaymentAt: periodStartIso
    });
  }

  setLifecycleState(tenantId, lifecycleState, fields = {}) {
    return this.upsertSubscriptionByTenantId(tenantId, {
      lifecycleState,
      status: fields.status,
      blockedAt: fields.blockedAt,
      retentionDeleteAt: fields.retentionDeleteAt
    });
  }

  getAllTenantSubscriptions() {
    return this.db.prepare('SELECT * FROM subscriptions ORDER BY tenant_id').all();
  }

  anonymizeTenantData(tenantId) {
    const suffix = `${tenantId}-${Date.now()}`;
    this.db.prepare('UPDATE users SET email = ? WHERE id IN (SELECT user_id FROM memberships WHERE tenant_id = ?)').run(
      `deleted+${suffix}@anonymized.local`,
      tenantId
    );
    this.db.prepare('UPDATE tenants SET organization_name = ? WHERE id = ?').run(`deleted-org-${suffix}`, tenantId);
  }

  deleteTenantOperationalData(tenantId) {
    this.db.prepare(`
      DELETE FROM node_status_history
      WHERE node_id IN (SELECT id FROM nodes WHERE tenant_id = ?)
    `).run(tenantId);
    this.db.prepare('DELETE FROM nodes WHERE tenant_id = ?').run(tenantId);
  }

  updateTenantNodeSoftLimit(tenantId, nodeSoftLimit) {
    const stmt = this.db.prepare(`
      UPDATE subscriptions
      SET node_soft_limit = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
    `);
    return stmt.run(Number(nodeSoftLimit), tenantId);
  }

  countTenantNodes(tenantId) {
    return this.db.prepare('SELECT COUNT(*) AS count FROM nodes WHERE tenant_id = ?').get(tenantId).count;
  }

  addNode(nodeData, tenantId) {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (tenant_id, name, chain_id, local_url, remote_url, custom_method, custom_params,
                        custom_headers, custom_response_path, custom_http_method, check_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      tenantId,
      nodeData.name,
      nodeData.chain_id,
      nodeData.local_url,
      nodeData.remote_url,
      nodeData.custom_method || null,
      nodeData.custom_params || '[]',
      nodeData.custom_headers || '{}',
      nodeData.custom_response_path || null,
      nodeData.custom_http_method || null,
      nodeData.check_interval ? Number(nodeData.check_interval) : 60
    );
  }

  getAllNodes(tenantId) {
    const stmt = this.db.prepare(`
      SELECT n.*, c.name as chain_name, c.symbol as chain_symbol,
             c.rpc_method as default_rpc_method, c.default_params as default_params,
             c.response_path as default_response_path, c.http_method as default_http_method
      FROM nodes n
      JOIN supported_chains c ON n.chain_id = c.id
      WHERE n.is_active = 1 AND n.tenant_id = ?
      ORDER BY n.name
    `);
    return stmt.all(tenantId);
  }

  getAllActiveNodesForMonitoring() {
    const stmt = this.db.prepare(`
      SELECT n.*, c.name as chain_name, c.symbol as chain_symbol,
             c.rpc_method as default_rpc_method, c.default_params as default_params,
             c.response_path as default_response_path, c.http_method as default_http_method
      FROM nodes n
      JOIN supported_chains c ON n.chain_id = c.id
      WHERE n.is_active = 1
      ORDER BY n.id
    `);
    return stmt.all();
  }

  getNodeById(id, tenantId) {
    const stmt = this.db.prepare(`
      SELECT n.*, c.name as chain_name, c.symbol as chain_symbol
      FROM nodes n
      JOIN supported_chains c ON n.chain_id = c.id
      WHERE n.id = ? AND n.tenant_id = ?
    `);
    return stmt.get(id, tenantId);
  }

  updateNode(id, tenantId, nodeData) {
    const stmt = this.db.prepare(`
      UPDATE nodes
      SET name = ?, chain_id = ?, local_url = ?, remote_url = ?, custom_method = ?,
          custom_params = ?, custom_headers = ?, custom_response_path = ?,
          custom_http_method = ?, check_interval = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `);

    return stmt.run(
      nodeData.name,
      nodeData.chain_id,
      nodeData.local_url,
      nodeData.remote_url,
      nodeData.custom_method || null,
      nodeData.custom_params || '[]',
      nodeData.custom_headers || '{}',
      nodeData.custom_response_path || null,
      nodeData.custom_http_method || null,
      nodeData.check_interval ? Number(nodeData.check_interval) : 60,
      id,
      tenantId
    );
  }

  updateNodeErrorCount(nodeId, tenantId, consecutiveErrorCount) {
    const stmt = this.db.prepare(`
      UPDATE nodes
      SET consecutive_error_count = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `);
    return stmt.run(Math.max(Number(consecutiveErrorCount) || 0, 0), nodeId, tenantId);
  }

  deleteNode(id, tenantId) {
    // First delete all status history records for this node
    const deleteHistoryStmt = this.db.prepare(`
      DELETE FROM node_status_history
      WHERE node_id IN (SELECT id FROM nodes WHERE id = ? AND tenant_id = ?)
    `);
    deleteHistoryStmt.run(id, tenantId);
    
    // Then delete the node
    const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ? AND tenant_id = ?');
    return stmt.run(id, tenantId);
  }

  // Status history methods
  addStatusHistory(nodeId, tenantId, statusData) {
    const node = this.db.prepare('SELECT id FROM nodes WHERE id = ? AND tenant_id = ?').get(nodeId, tenantId);
    if (!node) {
      throw new Error('Node not found for tenant');
    }

    const stmt = this.db.prepare(`
      INSERT INTO node_status_history (
        tenant_id, node_id, local_height, remote_height, delay, status, error_message,
        local_status_code, remote_status_code, local_response_body, remote_response_body,
        local_response_headers, remote_response_headers, local_response_ms, remote_response_ms,
        local_error, remote_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      tenantId,
      nodeId,
      statusData.localHeight,
      statusData.remoteHeight,
      statusData.delay,
      statusData.status,
      statusData.error || '',
      statusData.localStatusCode || null,
      statusData.remoteStatusCode || null,
      statusData.localResponseBody || null,
      statusData.remoteResponseBody || null,
      statusData.localResponseHeaders || null,
      statusData.remoteResponseHeaders || null,
      statusData.localResponseMs || null,
      statusData.remoteResponseMs || null,
      statusData.localError || null,
      statusData.remoteError || null
    );
  }

  getStatusHistory(nodeId, tenantId, limit = 100) {
    const stmt = this.db.prepare(`
      SELECT nsh.*
      FROM node_status_history nsh
      JOIN nodes n ON n.id = nsh.node_id
      WHERE nsh.node_id = ? AND n.tenant_id = ?
      ORDER BY checked_at DESC 
      LIMIT ?
    `);
    return stmt.all(nodeId, tenantId, limit);
  }

  getStatusHistoryByRange({ nodeId, tenantId, from, to, limit = 200, offset = 0 }) {
    const stmt = this.db.prepare(`
      SELECT *
      FROM node_status_history
      WHERE node_id = ? AND tenant_id = ? AND checked_at >= datetime(?) AND checked_at <= datetime(?)
      ORDER BY checked_at DESC
      LIMIT ?
      OFFSET ?
    `);
    return stmt.all(nodeId, tenantId, from, to, limit, offset);
  }

  countStatusHistoryByRange({ nodeId, tenantId, from, to }) {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM node_status_history
      WHERE node_id = ? AND tenant_id = ? AND checked_at >= datetime(?) AND checked_at <= datetime(?)
    `);
    const row = stmt.get(nodeId, tenantId, from, to);
    return row?.count || 0;
  }

  getLatestStatusByTenant(tenantId) {
    const stmt = this.db.prepare(`
      SELECT
        n.id,
        n.name,
        n.consecutive_error_count as errorCount,
        c.name as chain_name,
        c.symbol as chain_symbol,
        nsh.local_height as localHeight,
        nsh.remote_height as remoteHeight,
        nsh.delay,
        nsh.status,
        COALESCE(nsh.error_message, '') as error,
        nsh.checked_at as lastChecked,
        nsh.local_status_code as localStatusCode,
        nsh.remote_status_code as remoteStatusCode,
        nsh.local_response_ms as localResponseMs,
        nsh.remote_response_ms as remoteResponseMs
      FROM nodes n
      JOIN supported_chains c ON n.chain_id = c.id
      LEFT JOIN node_status_history nsh ON nsh.id = (
        SELECT id
        FROM node_status_history
        WHERE node_id = n.id AND tenant_id = n.tenant_id
        ORDER BY checked_at DESC
        LIMIT 1
      )
      WHERE n.tenant_id = ? AND n.is_active = 1
      ORDER BY n.name
    `);
    return stmt.all(tenantId);
  }

  // Utility methods
  close() {
    this.db.close();
  }

}

module.exports = DatabaseManager;
