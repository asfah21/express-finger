# 👆 Express Finger (Solutions ADMS Listener)

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?cacheSeconds=2592000)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14-brightgreen)
![Docker](https://img.shields.io/badge/docker-ready-blue)

**Express Finger** is a high-performance **Node.js** application designed to serve as a listener server for **Solution/ZKTeco Fingerprint** devices utilizing the **ADMS (Automatic Data Master Server)** push protocol.

It seamlessly captures attendance data pushed by biometric devices, securely persists it into a **PostgreSQL** database, and exposes a clean **RESTful API** for integration with your HR or ERP systems.

---

## ✨ Key Features

- **📡 ADMS Protocol Support**: Fully compatible with Solution/ZKTeco push protocols.
- **💾 Robust Data Persistence**: Efficiently stores attendance logs in PostgreSQL, now linked with integrated **Employee Directory**.
- **📂 Raw Data Archiving**: Automatically saves raw request payloads for audit trails and backup.
- **🔄 Hybrid Sync Worker**: Smart background PULL sync that auto-skips unroutable public IPs and connects via VPNs/LAN.
- **⚙️ Dynamic Settings**: Remotely configurable mappings for attendance types and device names without restarting backend.
- **🔐 Secure API**: Built-in API Key authentication for management endpoints.
- **🐳 Docker Ready**: Includes `Dockerfile` and `docker-compose.yml` for instant deployment.
- **📊 Statistical Insights**: API endpoints for daily stats, employee data, and device health checks.

---

## 🛠️ Tech Stack

- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express.js](https://expressjs.com/) (v5)
- **Database**: [PostgreSQL](https://www.postgresql.org/)
- **Containerization**: [Docker](https://www.docker.com/)

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v14+)
- PostgreSQL Database
- Docker & Docker Compose (optional, for containerized run)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/express-finger.git
   cd express-finger
   ```

2. **Install Dependencies**
   ```bash
   cd app
   npm install
   ```

3. **Configuration**
   Copy `.env.example` to `.env` and adjust your settings:
   ```bash
   cp .env.example .env
   ```

### Running Locally

```bash
# Start the server
npm start
```
The server will start on `http://localhost:8080` (or your configured port).

### Running with Docker 🐳

The easiest way to deploy for production:

```bash
docker-compose up -d --build
```
This spins up the listener service in a detached container.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Port for the server to listen on | `8080` |
| `PGUSER` | PostgreSQL Username | `your_username` |
| `PGPASSWORD` | PostgreSQL Password | `your_password` |
| `PGHOST` | PostgreSQL Host address | `127.0.0.1` |
| `PGDATABASE` | Database Name | `your_database` |
| `PGPORT` | PostgreSQL Port | `5432` |
| `API_KEY` | Secret key for accessing Management APIs | `your_api_key` |
| `RAW_DIR` | Directory to store raw request logs | `/tmp` |
| `MAX_LIMIT` | Max limit for query results | `1000` |

---

## 🔌 API Reference

### Device Endpoints (ADMS)
*These endpoints are used by the fingerprint machines.*

- `POST /iclock/cdata` - Receive attendance & operation logs.
- `GET /iclock/getrequest` - Device heartbeat & command check.

### Management API
*Requires `x-api-key` header.*

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/logs` | Fetch processed attendance logs (now mapped with Employee details, `absensi` status and `device_name`) |
| `CRUD` | `/api/employees` | Manage Employee directory mapping (GET, POST, PUT, DELETE) |
| `G/P` | `/api/settings` | Get/Put status types (Masuk/Pulang) and device name aliasing mappings |
| `GET` | `/api/stats/daily` | Get daily attendance statistics |
| `CRUD` | `/api/devices` | Manage allowed/priority devices for the background PULL sync worker |
| `POST` | `/api/sync` | Trigger an immediate manual PULL sync from a specific device via TCP |
| `GET` | `/api/raw` | List saved raw data files |
| `GET` | `/api/raw/:name` | Download a specific raw file |

---

## 📂 Project Structure

```
express-finger/
├── app/
│   ├── config/         # Database & App Config
│   ├── controllers/    # API Logic (Device & Admin)
│   ├── middleware/     # Auth & Error Handling
│   ├── routes/         # Express Routes
│   ├── utils/          # Helpers
│   └── server.js       # App Entry Point
├── data/               # Persistent Data Storage
├── docker-compose.yml  # Container Orchestration
└── Dockerfile          # Image Definition
```

---

## 📝 License

This project is licensed under the [ISC License](LICENSE).

---

<p align="center">
  Made with ❤️ by Azvan IT for fingerprint attendance PT GSI.
</p>
