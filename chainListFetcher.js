const fetch = require('node-fetch');

class ChainListFetcher {
  constructor() {
    this.chainListUrl = 'https://chainlist.org/rpcs.json';
  }

  async fetchChainData() {
    try {
      console.log('Fetching chain data from ChainList...');
      const response = await fetch(this.chainListUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const chains = await response.json();
      console.log(`Fetched ${chains.length} chains from ChainList`);
      return chains;
    } catch (error) {
      console.error('Failed to fetch chain data:', error.message);
      return [];
    }
  }

  // Filter and process chains for our use case
  processChains(chains) {
    const processedChains = [];
    
    // Define common RPC methods for different chain types
    const rpcMethods = {
      'eth_blockNumber': ['ETH', 'MATIC', 'BNB', 'AVAX', 'FTM', 'ARB', 'OP', 'BASE'],
      'getblockcount': ['BTC'],
      'eth_getBlockByNumber': ['ETH', 'MATIC', 'BNB', 'AVAX', 'FTM', 'ARB', 'OP', 'BASE'],
      'getblockchaininfo': ['BTC']
    };

    // Popular chains we want to prioritize
    const popularChains = [
      'Ethereum Mainnet', 'Bitcoin', 'Polygon', 'Binance Smart Chain',
      'Avalanche', 'Fantom', 'Arbitrum One', 'Optimism', 'Base',
      'Solana', 'Cardano', 'Polkadot', 'Cosmos', 'Chainlink',
      'Polygon Mumbai', 'Ethereum Sepolia', 'Arbitrum Sepolia'
    ];

    chains.forEach(chain => {
      // Skip testnets unless they're popular ones
      if (chain.testnet && !popularChains.some(popular => chain.name.includes(popular))) {
        return;
      }

      // Skip chains without RPC endpoints
      if (!chain.rpc || chain.rpc.length === 0) {
        return;
      }

      // Determine RPC method based on chain type
      let rpcMethod = 'eth_blockNumber'; // Default for EVM chains
      let responsePath = 'result';
      let httpMethod = 'POST';
      let blockTime = 15; // Default block time

      // Bitcoin-like chains
      if (chain.name.toLowerCase().includes('bitcoin') || 
          chain.chainId === 0 || 
          chain.nativeCurrency?.symbol === 'BTC') {
        rpcMethod = 'getblockcount';
        responsePath = 'result';
        blockTime = 600; // 10 minutes
      }
      // Solana
      else if (chain.name.toLowerCase().includes('solana') || 
               chain.nativeCurrency?.symbol === 'SOL') {
        rpcMethod = 'getSlot';
        responsePath = 'result';
        blockTime = 0.4; // ~400ms
      }
      // Cardano
      else if (chain.name.toLowerCase().includes('cardano') || 
               chain.nativeCurrency?.symbol === 'ADA') {
        rpcMethod = 'getCurrentSlot';
        responsePath = 'result';
        blockTime = 20; // 20 seconds
      }
      // EVM chains with different block times
      else if (chain.name.toLowerCase().includes('polygon') || 
               chain.nativeCurrency?.symbol === 'MATIC') {
        blockTime = 2;
      }
      else if (chain.name.toLowerCase().includes('binance') || 
               chain.nativeCurrency?.symbol === 'BNB') {
        blockTime = 3;
      }
      else if (chain.name.toLowerCase().includes('avalanche') || 
               chain.nativeCurrency?.symbol === 'AVAX') {
        blockTime = 2;
      }
      else if (chain.name.toLowerCase().includes('fantom') || 
               chain.nativeCurrency?.symbol === 'FTM') {
        blockTime = 1;
      }
      else if (chain.name.toLowerCase().includes('arbitrum') || 
               chain.nativeCurrency?.symbol === 'ARB') {
        blockTime = 0.25;
      }
      else if (chain.name.toLowerCase().includes('optimism') || 
               chain.nativeCurrency?.symbol === 'OP') {
        blockTime = 2;
      }
      else if (chain.name.toLowerCase().includes('base') || 
               chain.nativeCurrency?.symbol === 'ETH') {
        blockTime = 2;
      }

      // Get the first public RPC endpoint
      const publicRpc = chain.rpc.find(rpc => 
        rpc.url && 
        !rpc.url.includes('localhost') && 
        !rpc.url.includes('127.0.0.1') &&
        !rpc.url.includes('demo') &&
        !rpc.url.includes('api_key')
      );

      if (!publicRpc) {
        return; // Skip if no public RPC
      }

      const processedChain = {
        name: chain.name,
        symbol: chain.nativeCurrency?.symbol || 'UNKNOWN',
        rpc_method: rpcMethod,
        default_params: '[]',
        response_path: responsePath,
        http_method: httpMethod,
        block_time: blockTime,
        description: `${chain.name} (Chain ID: ${chain.chainId})`,
        chain_id: chain.chainId,
        rpc_urls: chain.rpc.map(rpc => rpc.url).slice(0, 5), // Limit to 5 URLs
        explorer: chain.explorers?.[0]?.url || '',
        is_testnet: Boolean(chain.testnet), // Ensure boolean
        icon: chain.icon || '',
        short_name: chain.shortName || ''
      };

      processedChains.push(processedChain);
    });

    // Sort by popularity and remove duplicates
    const uniqueChains = [];
    const seenNames = new Set();

    // First add popular chains
    popularChains.forEach(popularName => {
      const chain = processedChains.find(c => 
        c.name.toLowerCase().includes(popularName.toLowerCase()) ||
        popularName.toLowerCase().includes(c.name.toLowerCase())
      );
      if (chain && !seenNames.has(chain.name)) {
        uniqueChains.push(chain);
        seenNames.add(chain.name);
      }
    });

    // Then add remaining chains
    processedChains.forEach(chain => {
      if (!seenNames.has(chain.name)) {
        uniqueChains.push(chain);
        seenNames.add(chain.name);
      }
    });

    return uniqueChains.slice(0, 50); // Limit to 50 chains
  }

  async getProcessedChains() {
    const rawChains = await this.fetchChainData();
    return this.processChains(rawChains);
  }
}

module.exports = ChainListFetcher;
