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

### Kiosk `public` login (device-bound)

Login with a role `public` account additionally requires an approved kiosk
device: include the `x-device-id` header (the persistent UUID the kiosk keeps in
`localStorage`). Unknown devices are auto-registered as `pending`; login is only
allowed once a Super Admin approves and binds the device to the account. A
`public` session is effectively immortal — the heartbeat re-issues the JWT on
every beat — but it is strictly **1 user = 1 device**: any other active session
of the same account is revoked on login.

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
# Template Sync API

All template sync endpoints require authentication, API access, and admin privileges.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/template-sync/pull-master` | Read templates from the active master and store checksummed records. |
| POST | `/api/template-sync/dry-run/:deviceId` | Return a side-effect-free reconciliation plan. |
| POST | `/api/template-sync/push/:deviceId` | Reconcile templates to one target; writes are limited to supported capabilities. |
| POST | `/api/template-sync/push-all` | Reconcile all active non-master targets independently. |
| GET | `/api/template-sync/status` | Return device capability/master state and recent safe audit entries. |

Request JSON options for dry-run and push operations:

```json
{
  "allowDelete": false,
  "confirmDelete": false,
  "lockTimeoutMs": 120000
}
```

Deletes occur only when both delete flags are `true`; the default is non-destructive.
Responses contain operation status, actions, counts, checksums, and reasons for skipped/error items. Raw biometric payloads are never returned in sync logs.

# Manual Biometrics API

All manual biometric endpoints require authentication, API access, and admin privileges. Raw template data is only returned by the explicit download endpoint.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/biometrics?userId=<user_id>` | List active fingerprint/face template metadata for one employee. |
| POST | `/api/biometrics` | Store or update a template using `userId`, `templateType`, `templateIndex`, and base64 `base64` data. Optional `originalFilename`. |
| DELETE | `/api/biometrics/:id` | Soft-delete an active template record while preserving its history. |
| GET | `/api/biometrics/:id/download` | Download template metadata and base64 data for an explicit backup. |

`templateType` must be `fingerprint` or `face`; `templateIndex` must be an integer from 0 through 255. Manual uploads are limited to 1 MiB per template.
# Template Sync API

All template sync endpoints require authentication, API access, and admin privileges.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/template-sync/pull-master` | Read templates from the active master and store checksummed records. |
| POST | `/api/template-sync/dry-run/:deviceId` | Return a side-effect-free reconciliation plan. |
| POST | `/api/template-sync/push/:deviceId` | Reconcile templates to one target; writes are limited to supported capabilities. |
| POST | `/api/template-sync/push-all` | Reconcile all active non-master targets independently. |
| GET | `/api/template-sync/status` | Return device capability/master state and recent safe audit entries. |

Request JSON options for dry-run and push operations:

```json
{
  "allowDelete": false,
  "confirmDelete": false,
  "lockTimeoutMs": 120000
}
```

Deletes occur only when both delete flags are `true`; the default is non-destructive.
Responses contain operation status, actions, counts, checksums, and reasons for skipped/error items. Raw biometric payloads are never returned in sync logs.
# Kiosk Device Whitelist / Approval

Kiosk attendance devices (role `public`) must be registered and approved by a
Super Admin before they can log in or record attendance. Each approved device is
bound to exactly one public account (1 device = 1 user). Kiosk requests identify
themselves with the `x-device-id` header (configurable via `KIOSK_DEVICE_HEADER`).

## Kiosk device error codes

The server returns these machine-readable `code` values (HTTP 400/403) so the
kiosk can branch on the exact reason:

| Code | HTTP | Meaning |
|---|---|---|
| `DEVICE_REQUIRED` | 400 | `x-device-id` header missing |
| `DEVICE_UNREGISTERED` | 403 | Device not registered yet |
| `DEVICE_PENDING` | 403 | Device awaiting admin approval |
| `DEVICE_REVOKED` | 403 | Device access revoked |
| `DEVICE_BOUND_OTHER` | 403 | Device bound to another account |
| `FORBIDDEN_ROLE` | 403 | Non-public/superadmin role on a gated endpoint |

## `POST /api/kiosk-devices/register`

Registers (or refreshes) a kiosk device. Unknown devices are auto-registered as
`pending` so a Super Admin can approve them from the dashboard.

Request header: `x-device-id: <uuid>` (optional `name` in the JSON body).

## `GET /api/kiosk-devices`

Super Admin only. Lists all registered kiosk devices. Query params: `status`
(`pending` | `approved` | `revoked`), `limit`, `offset`.

## `PUT /api/kiosk-devices/:id/approve`

Super Admin only. Approves a device and binds it to a public account. Body:
`{ "user_id": <id> }`. Any existing sessions of the bound account are ended.

## `PUT /api/kiosk-devices/:id/revoke`

Super Admin only. Revokes a device (all its active sessions are force-logged-out).

## `PUT /api/kiosk-devices/:id/rename`

Super Admin only. Body: `{ "name": "<label>" }`.

## `PUT /api/kiosk-devices/:id/unbind`

Super Admin only. Unbinds the bound public account; the device returns to
`pending` and must be re-approved.

# Live Face Attendance

The public kiosk is available at `GET /live.html` and does not require a dashboard login. It uses the browser `getUserMedia` camera API and sends a captured JPEG image to `POST /api/live/attendance`. Unlike an RTSP worker, the Python service does not open a camera stream: the browser owns the camera permission and sends a current frame only when Masuk or Pulang is selected.
> **Gate (since kiosk device lock):** the attendance endpoints below require a
> valid JWT session **and** an approved kiosk device. The kiosk must send the
> `x-device-id` header and be logged in as the bound public account (or a
> superadmin). Unapproved / pending / revoked devices are rejected with the
> `DEVICE_*` codes above.

## `POST /api/live/attendance`


Request body:

```json
{ "type": 0, "image": "data:image/jpeg;base64,..." }
```

`type` is `0` for Masuk and `1` for Pulang. The service runs YOLO detection using `yolov8n.pt`, extracts one or more face candidates, generates `buffalo_l` embeddings, and compares them using cosine similarity against numeric filenames in `data/faces`, such as `1.jpg`, `2.png`. The matched filename is mapped to `employee.user_id`. A user cannot submit the same type more than once on the same WITA calendar date; the endpoint returns `409` with `Sudah absen`.

The recognition parameters can be tuned through `YOLO_CONF_THRESHOLD`, `FACE_SIM_THRESHOLD`, and `FACE_DET_SIZE`. The reference-inspired defaults are `0.40`, `0.35`, and `640`. Lowering the similarity threshold increases recall but also increases the risk of false matches; tune it using representative employee photos and real kiosk lighting.

For browser camera access, use HTTPS in production (or `localhost` during development), grant camera permission to the kiosk origin, keep the face centered in the guide, and ensure the reference photos contain one clear, front-facing face.

Successful response:

```json
{ "status": "success", "message": "Absensi berhasil", "data": { "fid": "1", "nama": "Employee", "type": 0 } }
```

## `GET /api/live/health`

Requires the normal API key or dashboard JWT and reports the face-service health and indexed reference count.

## `POST /api/live/reload`

Requires superadmin privileges. Reloads the reference embeddings after files in `data/faces` have changed.
