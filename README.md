# Node Sync Checker

A web-based monitoring tool for checking blockchain node synchronization status. This application compares local and remote node heights to determine sync status and provides a clean dashboard interface for managing multiple nodes.

## Features

- **Real-time Monitoring**: Check synchronization status of multiple blockchain nodes
- **Web Dashboard**: Clean, responsive interface for viewing node status
- **Node Management**: Add, edit, and delete nodes through the web interface
- **Status Classification**: Automatically categorizes nodes as Healthy, Degrading, Out of Sync, Offline, or Unknown
- **Export Functionality**: Export monitoring data to CSV format
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

2. Start the application:
```bash
docker-compose up -d
```

3. Open your browser and navigate to `http://localhost:3000`

### Manual Installation

1. Install Node.js dependencies:
```bash
npm install express node-fetch
```

2. Start the server:
```bash
node server.js
```

3. Open your browser and navigate to `http://localhost:3000`

## Configuration

### Adding Nodes

Use the web interface to add nodes or manually edit `nodes.json`:

```json
[
  {
    "name": "Ethereum Mainnet",
    "local": "http://localhost:8545",
    "remote": "https://mainnet.infura.io/v3/YOUR_PROJECT_ID",
    "method": "eth_blockNumber",
    "params": [],
    "headers": {},
    "responsePath": "result",
    "httpMethod": "POST"
  }
]
```

### Configuration Fields

- **name**: Unique identifier for the node
- **local**: URL of your local node
- **remote**: URL of the reference/remote node
- **method**: RPC method to call (e.g., `eth_blockNumber`, `eth_getBlockByNumber`)
- **params**: JSON array of parameters for the RPC call
- **headers**: Additional HTTP headers (JSON object)
- **responsePath**: Path to extract the block height from response (e.g., `result`, `result.header.height`)
- **httpMethod**: HTTP method to use (`POST` or `GET`)

## API Endpoints

- `GET /` - Serves the web dashboard
- `GET /status` - Returns current status of all configured nodes
- `POST /add` - Add a new node
- `PUT /edit/:name` - Edit an existing node
- `DELETE /delete/:name` - Delete a node

## Docker Configuration

The application includes Docker support with:

- **Dockerfile**: Multi-stage build using Node.js 20 Alpine
- **docker-compose.yml**: Complete setup with volume mounts for persistence

### Docker Compose Services

- **sync-checker**: Main application service
- **Port**: 3000 (mapped to host)
- **Volumes**: 
  - `nodes.json` - Node configurations
  - `status.json` - Status cache
  - `public/` - Static web assets

## File Structure

```
node-sync/
├── server.js              # Main Express server
├── nodes.json             # Node configurations
├── status.json            # Status cache
├── public/
│   ├── index.html         # Web dashboard
│   └── frontend.js        # Frontend JavaScript
├── docker-compose.yml     # Docker Compose configuration
├── Dockerfile            # Docker image definition
└── README.md             # This file
```

## Environment Variables

- `PORT`: Server port (default: 3000)

## Development

### Prerequisites

- Node.js 20+
- Docker (optional)

### Running in Development

1. Install dependencies:
```bash
npm install express node-fetch
```

2. Start the development server:
```bash
node server.js
```

3. The server will start on `http://localhost:3000`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and questions, please open an issue on the GitHub repository.