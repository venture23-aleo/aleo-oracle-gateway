# Aleo Oracle Gateway

A TypeScript-based server that automatically updates token prices on the Aleo blockchain using SGX-attested price feeds. Developed by Venture23.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Environment
```bash
cp .env_sample .env
# Edit .env and set your PRIVATE_KEY
```

### 3. Install Leo CLI
Install the latest Leo CLI (v2.7.3) from [Leo documentation](https://docs.leo-lang.org/getting_started/installation)

### 4. Run the Server
```bash
# Development
npm run dev

# Production
npm run build && npm start
```

## 📋 What It Does

1. **Fetches Price Data**: Gets attested price feeds from notarization servers
2. **Updates Blockchain**: Executes Aleo programs to update prices on-chain
3. **Schedules Updates**: Runs automated price updates via cron jobs
4. **Tracks History**: Stores price data locally in `prices/` folder
5. **Sends Notifications**: Discord alerts for errors and status updates

## 🔧 Configuration

### Required Environment Variables
- `PRIVATE_KEY` - Your Aleo private key (required)
- `INTERNAL_API_KEY` - API key for authentication (required)

### Optional Overrides
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 8080)
- `SUPPORTED_COINS` - Comma-separated list (default: BTC,ETH,ALEO)
- `DISCORD_WEBHOOK_URL` - Discord notifications

Most settings have sensible defaults in `config/default.json`.

## 📡 API Endpoints

### Health & Status
- `GET /api/health` - Server health check
- `GET /api/oracle/status` - Oracle service status
- `GET /api/oracle/stats` - Service statistics

### Oracle Operations
- `POST /api/oracle/set-sgx-unique-id` - Initialize SGX unique ID
- `POST /api/oracle/set-public-key` - Set public key
- `POST /api/oracle/set-sgx-data/:coinName` - Update specific coin price
- `POST /api/oracle/set-sgx-data-all` - Update all coin prices
- `GET /api/oracle/coins` - List supported coins

### Cron Job Control
- `POST /api/oracle/cron/start` - Start automated updates
- `POST /api/oracle/cron/stop` - Stop automated updates
- `GET /api/oracle/cron/status` - Cron job status

## 🏗️ Project Structure

```
├── server.ts                 # Main server entry point
├── config/                   # Configuration files
│   ├── default.json         # Default settings
│   └── custom-environment-variables.json # Env var mapping
├── src/
│   ├── routes/              # API endpoints
│   ├── services/            # Business logic
│   ├── utils/               # Utilities (logging, Leo CLI, etc.)
│   └── middleware/          # Request middleware
├── prices/                  # Price history files
└── logs/                    # Application logs
```

## 🔄 How It Works

1. **Cron Trigger** → Scheduled job starts price update
2. **Notarization** → Server requests attested price data
3. **SGX Attestation** → Receives cryptographically signed price
4. **Blockchain Update** → Leo CLI executes Aleo program
5. **Price Tracking** → Stores successful prices locally
6. **Notifications** → Sends Discord alerts

## 🛠️ Development

### Available Scripts
```bash
npm run dev          # Development with auto-restart
npm run build        # Compile TypeScript
npm run start        # Start production server
npm run typecheck    # Type checking
npm run lint         # Code linting
npm run format       # Code formatting
npm run code:fix     # Fix linting and formatting
```

### Code Quality
- **TypeScript** for type safety
- **ESLint** for code quality
- **Prettier** for code formatting
- **Zod** for configuration validation

## 🐛 Troubleshooting

### Common Issues
1. **Leo CLI not found** - Install latest Leo CLI v2.7.3
2. **Private key error** - Verify `PRIVATE_KEY` is set correctly
3. **Network errors** - Check connectivity to notarization servers
4. **Type errors** - Run `npm run typecheck`

### Debug Mode
Set `NODE_ENV=development` for detailed logging.

## 📊 Monitoring

- **Health checks** at `/api/health`
- **Service statistics** at `/api/oracle/stats`
- **Price history** in `prices/` folder
- **Application logs** in `logs/` directory
- **Discord notifications** for alerts

## 🔐 Security

- API key authentication for endpoints
- Helmet.js security headers
- Input validation with Zod
- Secure environment variable handling

## 📄 License

GPL-3.0 License

---

**Developed by Venture23**
