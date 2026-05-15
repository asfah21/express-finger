# AZRA GSI Fingerprint API Documentation

Welcome to the AZRA GSI Fingerprint API Documentation. This API allows external systems (such as HRIS, ProInt, PIHKA, or ERP systems) to securely interact with the fingerprint attendance data, employee records, and device configurations.

## Base URL
All API requests should be prefixed with your server's host and the `/api` route.
`http://<SERVER_IP>:<PORT>/api`

## Authentication

All API endpoints are protected and require an API Key. 

You must include the API Key in the headers of every request using the `x-api-key` header. 
You can find or configure the API Key in the AZRA Dashboard under the **Settings** menu.

**Header Example:**
```http
x-api-key: your-secret-api-key
```

---

## 1. Attendance Logs

### Get Attendance Logs
Retrieve attendance logs with optional filtering and pagination.

**Endpoint:** `GET /logs`

**Query Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `limit` | integer | No | Number of records to return (Default: 100, Max: 50000) |
| `offset` | integer | No | Number of records to skip for pagination (Default: 0) |
| `from` | string | No | Start date/time in ISO format (e.g. `2026-05-01T00:00:00+08:00`) |
| `to` | string | No | End date/time in ISO format (e.g. `2026-05-31T23:59:59+08:00`) |
| `user_id` | string | No | Filter by specific employee's User ID |
| `type` | integer | No | Filter by attendance type (`0` = Check-in, `1` = Check-out) |
| `search` | string | No | Search by employee name |

**Success Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "total": 1250,
    "limit": 100,
    "offset": 0,
    "has_more": true,
    "logs": [
      {
        "id": "1",
        "user_id": "101",
        "nik": "12345678",
        "nama": "John Doe",
        "jabatan": "Staff IT",
        "department": "GSI",
        "divisi": "IT",
        "emp_type": "S75",
        "type": 0,
        "absensi": "Masuk",
        "device_name": "Office 1",
        "device_sn": "BBSN123456",
        "timestamp": "2026-05-15T08:00:00.000Z",
        "created_at": "2026-05-15T08:05:00.000Z",
        "ket": "Terlambat 15 menit"
      }
    ]
  }
}
```

### Get Daily Attendance Summary (Paired)
Retrieve attendance data specifically formatted for ERP/HRIS integration, where Check-In and Check-Out times are paired per user per day.

**Endpoint:** `GET /logs/summary`

**Query Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `from_date` | string | No | Start date in `YYYY-MM-DD` format (Default: Today) |
| `to_date` | string | No | End date in `YYYY-MM-DD` format (Default: Today) |
| `user_id` | string | No | Filter by specific employee's User ID |
| `limit` | integer | No | Number of records to return (Default: 1000) |
| `offset` | integer | No | Pagination offset |

**Success Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "from_date": "2026-05-15",
    "to_date": "2026-05-15",
    "count": 1,
    "summary": [
      {
        "date": "2026-05-15",
        "user_id": "101",
        "nik": "12345678",
        "nama": "John Doe",
        "department": "GSI",
        "jabatan": "Staff IT",
        "check_in": "07:55:00",
        "check_out": "17:15:30",
        "work_hours": "09:20",
        "status": "Hadir Penuh"
      }
    ]
  }
}
```

---

## 2. Employees

### Get Employee List
Retrieve all registered employees.

**Endpoint:** `GET /employees`

**Query Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `limit` | integer | No | Number of records to return (Default: 100) |
| `offset` | integer | No | Number of records to skip |
| `search` | string | No | Search by employee name or NIK |

**Success Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "total": 50,
    "list": [
      {
        "id": 1,
        "user_id": "101",
        "nik": "12345678",
        "nama": "John Doe",
        "jabatan": "Staff IT",
        "department": "GSI",
        "divisi": "IT",
        "type": "S75",
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### Add New Employee
Register a new employee to the system.

**Endpoint:** `POST /employees`

**Request Body:**
```json
{
  "user_id": "105",
  "nama": "Jane Doe",
  "nik": "87654321",
  "jabatan": "Manager",
  "department": "GSI",
  "divisi": "HR",
  "type": "S75"
}
```

### Bulk Add Employees
Register multiple employees at once.

**Endpoint:** `POST /employees/bulk`

**Request Body:**
```json
{
  "employees": [
    { "user_id": "106", "nama": "Alice", "nik": "1111" },
    { "user_id": "107", "nama": "Bob", "nik": "2222" }
  ]
}
```

---

## 3. Devices & Synchronization

### Get Device List
Retrieve a list of connected fingerprint devices and their online status.

**Endpoint:** `GET /devices`

**Success Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "list": [
      {
        "id": 1,
        "sn": "BBSN123456",
        "name": "Front Office",
        "ip": "192.168.1.10",
        "port": 4370,
        "is_active": true,
        "status": "online",
        "sync_mode": "HYBRID",
        "last_sync": "2026-05-15T09:00:00.000Z",
        "last_online": "2026-05-15T09:35:00.000Z"
      }
    ]
  }
}
```

### Trigger Device Sync (PULL)
Force the server to pull attendance logs from a specific device immediately.

**Endpoint:** `POST /pull`

**Request Body:**
```json
{
  "deviceId": 1,
  "preview": false,
  "clearAfterSync": false
}
```
*Note: Set `preview: true` to test the connection and see logs without saving them to the database.*

**Success Response (200 OK):**
```json
{
  "status": "success",
  "message": "Successfully pulled and synced 15 logs from device.",
  "data": {
    "total": 15,
    "saved": 15,
    "cleared": false,
    "logs": []
  }
}
```

---

## Error Handling

The API uses standard HTTP status codes to indicate the success or failure of an API request.

| Status Code | Description |
| :--- | :--- |
| `200` | **OK** - The request was successful. |
| `201` | **Created** - The resource was successfully created. |
| `400` | **Bad Request** - Missing or invalid parameters. |
| `401` | **Unauthorized** - Missing or invalid API Key. |
| `403` | **Forbidden** - Insufficient permissions. |
| `404` | **Not Found** - The requested resource does not exist. |
| `500` | **Internal Server Error** - Server encountered an unexpected condition. |

**Error Response Example:**
```json
{
  "status": "error",
  "message": "Authentication required (API Key or Token)"
}
```
