# Node Sync Checker

A web-based monitoring tool for checking blockchain node synchronization status. This application compares local and remote node heights to determine sync status and provides a clean dashboard interface for managing multiple nodes.

## Features

- **Real-time Monitoring**: Check synchronization status of multiple blockchain nodes
- **Web Dashboard**: Clean, responsive interface for viewing node status
- **Node Management**: Add, edit, and delete nodes through the web interface
- **Chain Management**: View, edit, and manage blockchain network configurations
- **Custom Chain Support**: Add your own blockchain networks with custom settings
- **Status Classification**: Automatically categorizes nodes as Healthy, Degrading, Out of Sync, Offline, or Unknown
- **Status History**: Track node status over time with historical data
- **Export Functionality**: Export monitoring data to CSV format
- **SQLite Database**: Lightweight, persistent storage for nodes and chain configurations
- **Docker Support**: Easy deployment with Docker and Docker Compose
- **Flexible Configuration**: Support for different RPC methods, HTTP methods, and custom headers

## Status Categories

- **Healthy**: Delay < 5 blocks
- **Degrading**: Delay 5-19 blocks  
- **Out of Sync**: Delay ≥ 20 blocks
- **Offline**: Local node unreachable
- **Unknown**: Remote node unreachable or other errors

## Quick Start

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone <repository-url>
cd node-sync
```

2. Create db file:
```bash
cp sync_checker.db.example sync_checker.db
```

3. Start the application:
```bash
docker-compose up --build -d
```

3. Open your browser and navigate to `http://localhost:3000`

### Manual Installation

1. Install Node.js dependencies:
```bash
npm install express node-fetch better-sqlite3
```

2. Initialize blockchain networks:
```bash
npm run init-chains
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to `http://localhost:3000`

## Configuration

### Supported Chains

The application automatically fetches and populates supported blockchain networks from [ChainList](https://chainlist.org/rpcs.json), including:

- **Ethereum Mainnet**: ETH, `eth_blockNumber` method
- **Polygon**: MATIC, `eth_blockNumber` method  
- **Binance Smart Chain**: BNB, `eth_blockNumber` method
- **Avalanche**: AVAX, `eth_blockNumber` method
- **Arbitrum One**: ARB, `eth_blockNumber` method
- **Optimism**: OP, `eth_blockNumber` method
- **Base**: ETH, `eth_blockNumber` method
- **And 40+ more networks** with real RPC endpoints

Each chain comes with:
- Pre-configured RPC methods and parameters
- Multiple public RPC endpoints
- Correct block times and response paths
- Explorer links and metadata

### Adding Nodes

Use the web interface to add nodes. The form now includes:

- **Node Name**: Unique identifier for the node
- **Blockchain Network**: Dropdown with 50+ supported chains from ChainList
- **Local URL**: URL of your local node
- **Remote URL**: Pre-filled with public RPC endpoints from ChainList
- **Custom Settings** (optional): Override chain defaults for RPC method, parameters, headers, etc.

When you select a blockchain network, the form automatically populates with:
- Default RPC method (e.g., `eth_blockNumber`)
- Default parameters (usually `[]`)
- Default response path (`result`)
- Public RPC endpoints for the remote URL

### Chain Management

The **Chains** tab provides comprehensive management of blockchain network configurations:

- **View All Chains**: See all supported networks with their configurations
- **Edit Chain Settings**: Modify RPC methods, block times, parameters, and endpoints
- **Add Custom Chains**: Create new blockchain network configurations
- **Delete Chains**: Remove unused or incorrect chain configurations
- **Testnet/Mainnet Indicators**: Visual badges to distinguish network types

#### Chain Configuration Fields

- **Name**: Display name for the blockchain network
- **Symbol**: Native token symbol (e.g., ETH, BTC, MATIC)
- **Chain ID**: Unique identifier for the network
- **RPC Method**: Default RPC method for block height queries
- **Default Params**: Default parameters for RPC calls
- **Response Path**: Path to extract block height from response
- **HTTP Method**: HTTP method for RPC calls (POST/GET)
- **Block Time**: Average time between blocks in seconds
- **Description**: Additional information about the network
- **Explorer URL**: Block explorer URL for the network
- **RPC URLs**: List of public RPC endpoints
- **Testnet Flag**: Whether this is a testnet or mainnet

### Node Configuration Fields

- **name**: Unique identifier for the node
- **chain_id**: ID of the supported chain
- **local_url**: URL of your local node
- **remote_url**: URL of the reference/remote node
- **custom_method**: Override the chain's default RPC method
- **custom_params**: Override the chain's default parameters
- **custom_headers**: Additional HTTP headers (JSON object)
- **custom_response_path**: Override the chain's default response path
- **custom_http_method**: Override the chain's default HTTP method

## API Endpoints

### Node Management
- `GET /` - Serves the web dashboard
- `GET /status` - Returns current status of all configured nodes
- `GET /nodes/:id` - Get individual node data for editing
- `POST /add` - Add a new node
- `PUT /edit/:id` - Edit an existing node
- `DELETE /delete/:id` - Delete a node
- `GET /nodes/:id/history` - Get status history for a node

### Chain Management
- `GET /chains` - Get all supported chains
- `POST /chains` - Add a new supported chain
- `PUT /chains/:id` - Edit an existing chain
- `DELETE /chains/:id` - Delete a chain

## Docker Configuration

The application includes Docker support with:

- **Dockerfile**: Multi-stage build using Node.js 20 Alpine
- **docker-compose.yml**: Complete setup with volume mounts for persistence

### Docker Compose Services

- **sync-checker**: Main application service
- **Port**: 3000 (mapped to host)
- **Volumes**: 
  - `sync_checker.db` - SQLite database file
  - `public/` - Static web assets

## File Structure

```
node-sync/
├── server.js              # Main Express server
├── database.js            # Database manager and schema
├── sync_checker.db        # SQLite database (created on first run)
├── public/
│   ├── index.html         # Web dashboard
│   └── frontend.js        # Frontend JavaScript
├── docker-compose.yml     # Docker Compose configuration
├── Dockerfile            # Docker image definition
├── package.json          # Node.js dependencies
└── README.md             # This file
```

## Environment Variables

- `PORT`: Server port (default: 3000)

## Chain Management

### Initializing Chains

The application uses a separate script to initialize blockchain networks from ChainList:

```bash
# Initialize chains from ChainList (first time)
npm run init-chains

# Force reinitialize (clears existing chains)
npm run init-chains-force

# List all chains in database
npm run list-chains
```

### Chain Management Commands

```bash
# Initialize chains
node init-chains.js

# Force reinitialize (clears existing)
node init-chains.js force

# List current chains
node init-chains.js list

# Show help
node init-chains.js help
```

## Development

### Prerequisites

- Node.js 20+
- Docker (optional)

### Running in Development

1. Install dependencies:
```bash
npm install express node-fetch better-sqlite3
```

2. Initialize chains:
```bash
npm run init-chains
```

2(a). Initialize chains from backup:
```bash
cp sync_checker.db.example sync_checker.db
```

3. Start the development server:
```bash
npm start
```

4. The server will start on `http://localhost:3000`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and questions, please open an issue on the GitHub repository.