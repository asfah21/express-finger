# 👆 Express Finger (GSI ADMS Listener & WEB Dashboard)

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg?cacheSeconds=2592000)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen)
![Docker](https://img.shields.io/badge/docker-ready-blue)

**Express Finger** is a high-performance **Node.js** application designed to serve as a listener server for **Solution/ZKTeco Fingerprint** devices utilizing the **ADMS (Automatic Data Master Server)** push protocol.

Now featuring a **Modern Web Dashboard (GUI)** for seamless management of devices, employees, and real-time attendance monitoring.

---

## ✨ Key Features

- **🌐 Modern Web Dashboard**: Aesthetic glassmorphism GUI for non-technical users.
- **📡 ADMS Protocol Support**: Fully compatible with Solution/ZKTeco push protocols.
- **🔐 Dual-Layer Security**: JWT Authentication for Dashboard and API Key for external systems.
- **💾 Robust Data Persistence**: Efficiently stores attendance logs in PostgreSQL.
- **🔄 Hybrid Sync Worker**: Smart background PULL sync that auto-skips unroutable public IPs.
- **👥 Employee Management**: GUI for managing employee directories and syncing them from devices.
- **🐳 Docker Ready**: Includes `Dockerfile` and `docker-compose.yml` for instant deployment.

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- PostgreSQL Database
- Docker (optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/express-finger.git
   cd express-finger/app
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configuration**
   Copy `.env.example` to `.env` and set your database and security keys:
   ```bash
   cp .env.example .env
   ```

4. **Start the server**
   ```bash
   npm start
   ```

Accessed the dashboard at: `http://localhost:8080`
- **User**: `admin`
- **Pass**: `admin123`

---

## 🛠️ API Reference

All Management APIs now return a standardized JSON format:
`{ "status": "success", "data": { ... } }`

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/auth/login` | Login to get JWT Token |
| `GET` | `/api/logs` | Fetch processed attendance logs |
| `CRUD` | `/api/employees` | Manage Employee directory |
| `CRUD` | `/api/devices` | Manage Fingerprint Devices |
| `POST` | `/api/sync/all` | Trigger global PULL synchronization |

---

## 🐳 Docker Deployment

For instant production setup:
```bash
docker-compose up -d --build
```

---

<p align="center">
  Made with ❤️ by AAI (Antigravity AI) for PT GSI Fingerprint Systems.
</p>
