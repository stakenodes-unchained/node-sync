const Database = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
  constructor(dbPath = './sync_checker.db') {
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    // Create tables if they don't exist
    this.createTables();
  }

  createTables() {
    // Supported chains table
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

    // Nodes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        chain_id INTEGER NOT NULL,
        local_url TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        custom_method TEXT,
        custom_params TEXT DEFAULT '[]',
        custom_headers TEXT DEFAULT '{}',
        custom_response_path TEXT,
        custom_http_method TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chain_id) REFERENCES supported_chains (id)
      )
    `);

    // Node status history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id INTEGER NOT NULL,
        local_height INTEGER,
        remote_height INTEGER,
        delay INTEGER,
        status TEXT NOT NULL,
        error_message TEXT,
        checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (node_id) REFERENCES nodes (id)
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nodes_chain_id ON nodes(chain_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_active ON nodes(is_active);
      CREATE INDEX IF NOT EXISTS idx_status_history_node_id ON node_status_history(node_id);
      CREATE INDEX IF NOT EXISTS idx_status_history_checked_at ON node_status_history(checked_at);
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
  addNode(nodeData) {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (name, chain_id, local_url, remote_url, custom_method, custom_params, 
                        custom_headers, custom_response_path, custom_http_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      nodeData.custom_http_method || null
    );
  }

  getAllNodes() {
    const stmt = this.db.prepare(`
      SELECT n.*, c.name as chain_name, c.symbol as chain_symbol,
             c.rpc_method as default_rpc_method, c.default_params as default_params,
             c.response_path as default_response_path, c.http_method as default_http_method
      FROM nodes n
      JOIN supported_chains c ON n.chain_id = c.id
      WHERE n.is_active = 1
      ORDER BY n.name
    `);
    return stmt.all();
  }

  getNodeById(id) {
    const stmt = this.db.prepare(`
      SELECT n.*, c.name as chain_name, c.symbol as chain_symbol
      FROM nodes n
      JOIN supported_chains c ON n.chain_id = c.id
      WHERE n.id = ?
    `);
    return stmt.get(id);
  }

  updateNode(id, nodeData) {
    const stmt = this.db.prepare(`
      UPDATE nodes 
      SET name = ?, chain_id = ?, local_url = ?, remote_url = ?, custom_method = ?, 
          custom_params = ?, custom_headers = ?, custom_response_path = ?, 
          custom_http_method = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
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
      id
    );
  }

  deleteNode(id) {
    const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    return stmt.run(id);
  }

  // Status history methods
  addStatusHistory(nodeId, statusData) {
    const stmt = this.db.prepare(`
      INSERT INTO node_status_history (node_id, local_height, remote_height, delay, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      nodeId,
      statusData.localHeight,
      statusData.remoteHeight,
      statusData.delay,
      statusData.status,
      statusData.error || ''
    );
  }

  getStatusHistory(nodeId, limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM node_status_history 
      WHERE node_id = ? 
      ORDER BY checked_at DESC 
      LIMIT ?
    `);
    return stmt.all(nodeId, limit);
  }

  // Utility methods
  close() {
    this.db.close();
  }

}

module.exports = DatabaseManager;
