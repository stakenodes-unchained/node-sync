#!/usr/bin/env node

const DatabaseManager = require('./database');
const ChainListFetcher = require('./chainListFetcher');

class ChainInitializer {
  constructor() {
    this.db = new DatabaseManager();
  }

  async initializeChains() {
    console.log('🚀 Starting chain initialization...');
    
    try {
      // Check if chains already exist
      const existingChains = this.db.getAllChains();
      if (existingChains.length > 0) {
        console.log(`✅ Found ${existingChains.length} existing chains in database`);
        console.log('Chains already initialized. Use --force to reinitialize.');
        return;
      }

      console.log('📡 Fetching chains from ChainList...');
      const chainFetcher = new ChainListFetcher();
      const chains = await chainFetcher.getProcessedChains();
      
      console.log(`📊 Processing ${chains.length} chains from ChainList...`);
      
      let addedCount = 0;
      let skippedCount = 0;
      
      for (const chain of chains) {
        try {
          this.db.addChain(chain);
          addedCount++;
          console.log(`✅ Added: ${chain.name} (${chain.symbol})`);
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) {
            skippedCount++;
            console.log(`⏭️  Skipped: ${chain.name} (already exists)`);
          } else {
            console.error(`❌ Error adding ${chain.name}:`, error.message);
          }
        }
      }
      
      console.log(`\n🎉 Chain initialization complete!`);
      console.log(`✅ Added: ${addedCount} chains`);
      console.log(`⏭️  Skipped: ${skippedCount} chains`);
      
    } catch (error) {
      console.error('❌ Failed to initialize chains from ChainList:', error.message);
      console.log('🔄 Falling back to basic default chains...');
      
      await this.addFallbackChains();
    }
  }

  async addFallbackChains() {
    const fallbackChains = [
      {
        name: 'Ethereum Mainnet',
        symbol: 'ETH',
        rpc_method: 'eth_blockNumber',
        default_params: '[]',
        response_path: 'result',
        http_method: 'POST',
        block_time: 15,
        description: 'Ethereum Mainnet',
        chain_id: 1,
        rpc_urls: ['https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com'],
        explorer: 'https://etherscan.io',
        is_testnet: false,
        icon: 'ethereum',
        short_name: 'eth'
      },
      {
        name: 'Polygon Mainnet',
        symbol: 'MATIC',
        rpc_method: 'eth_blockNumber',
        default_params: '[]',
        response_path: 'result',
        http_method: 'POST',
        block_time: 2,
        description: 'Polygon Mainnet',
        chain_id: 137,
        rpc_urls: ['https://polygon-rpc.com', 'https://rpc-mainnet.matic.network'],
        explorer: 'https://polygonscan.com',
        is_testnet: false,
        icon: 'polygon',
        short_name: 'matic'
      },
      {
        name: 'Binance Smart Chain',
        symbol: 'BNB',
        rpc_method: 'eth_blockNumber',
        default_params: '[]',
        response_path: 'result',
        http_method: 'POST',
        block_time: 3,
        description: 'Binance Smart Chain Mainnet',
        chain_id: 56,
        rpc_urls: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
        explorer: 'https://bscscan.com',
        is_testnet: false,
        icon: 'bnb',
        short_name: 'bsc'
      }
    ];

    let addedCount = 0;
    for (const chain of fallbackChains) {
      try {
        this.db.addChain(chain);
        addedCount++;
        console.log(`✅ Added fallback chain: ${chain.name}`);
      } catch (error) {
        console.log(`⏭️  Fallback chain ${chain.name} already exists or error occurred:`, error.message);
      }
    }
    
    console.log(`✅ Added ${addedCount} fallback chains`);
  }

  async forceReinitialize() {
    console.log('🔄 Force reinitializing chains...');
    
    // Clear existing chains
    const existingChains = this.db.getAllChains();
    for (const chain of existingChains) {
      try {
        this.db.deleteChain(chain.id);
        console.log(`🗑️  Deleted: ${chain.name}`);
      } catch (error) {
        console.log(`⚠️  Could not delete ${chain.name}: ${error.message}`);
      }
    }
    
    // Reinitialize
    await this.initializeChains();
  }

  async listChains() {
    const chains = this.db.getAllChains();
    console.log(`\n📋 Current chains in database (${chains.length} total):`);
    console.log('─'.repeat(80));
    
    chains.forEach(chain => {
      const type = chain.is_testnet ? 'Testnet' : 'Mainnet';
      const chainId = chain.chain_id ? ` (ID: ${chain.chain_id})` : '';
      console.log(`• ${chain.name}${chainId} - ${chain.symbol} [${type}]`);
      console.log(`  RPC: ${chain.rpc_method} | Block Time: ${chain.block_time}s`);
      if (chain.description) {
        console.log(`  ${chain.description}`);
      }
      console.log('');
    });
  }

  close() {
    this.db.close();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'init';
  
  const initializer = new ChainInitializer();
  
  try {
    switch (command) {
      case 'init':
        await initializer.initializeChains();
        break;
      case 'force':
        await initializer.forceReinitialize();
        break;
      case 'list':
        await initializer.listChains();
        break;
      case 'help':
        console.log(`
🔗 Chain Initializer

Usage: node init-chains.js [command]

Commands:
  init    Initialize chains from ChainList (default)
  force   Force reinitialize (clears existing chains)
  list    List all chains in database
  help    Show this help message

Examples:
  node init-chains.js           # Initialize chains
  node init-chains.js force    # Force reinitialize
  node init-chains.js list     # List current chains
        `);
        break;
      default:
        console.log(`❌ Unknown command: ${command}`);
        console.log('Use "node init-chains.js help" for usage information');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    initializer.close();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = ChainInitializer;
