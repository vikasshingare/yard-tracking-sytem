# Container Yard Management & Tracking

Mobile-first yard operations app with an Expo client, Express API, a React admin panel, and MariaDB/MySQL.

## Architecture

```text
Expo mobile app  --JWT/JSON-->    Express API  --mysql2 pool-->  MySQL
React admin panel --JWT/JSON-->    role checks + audit       containers, locations,
  records + users                                            users, transactions
```

The API stores each operation and its audit event in one database transaction. A container's current location is updated alongside its event history. Scan values are treated as identifiers; the app does not rely on typing.

## Folder structure

```text
backend/
  .env.example
  package.json
  server.js
  routes/yard.js
  routes/brd.js
  routes/auth.js
  middleware/auth.js
  middleware/idempotency.js
  sql/schema.sql
  sql/migrate-brd.sql
  sql/migrate-user-gates.sql
  sql/migrate-auth.sql
  sql/migrate-location-hierarchy.sql
  scripts/create-admin.js
  scripts/seed-samples.js
admin/
  src/main.jsx
  src/style.css
mobile/
  App.js
  app.json
  package.json
  src/api.js
  src/components/BarcodeScanner.js
  src/components/LocationCapture.js
  src/screens/GateInScreen.js
  src/screens/PutAwayMoveScreen.js
  src/screens/GateOutScreen.js
  src/screens/LoginScreen.js
  src/screens/InventoryScreen.js
  src/screens/HistoryScreen.js
  src/screens/ContainerDetailsScreen.js
  src/screens/TrackScreen.js
  src/screens/ShipmentsScreen.js
  src/screens/SyncStatusScreen.js
  src/offlineQueue.js
```

## Database and backend

1. Create a MySQL database, then run `backend/sql/schema.sql` against it. On this machine, a separate local MariaDB instance is initialized under `backend/.local-mysql` so it does not touch the existing XAMPP data directory.
2. In `backend`, copy `.env.example` to `.env` and set the database credentials plus a `JWT_SECRET` of at least 32 characters.
3. Run `npm install` and `npm start`.

The API listens on port 3000 by default. Login at `POST /api/auth/login` to receive a JWT. Container actions record the signed-in user from the token; clients cannot choose the audit user ID.

For an older first-version database, apply `backend/sql/migrate-auth.sql`, `backend/sql/migrate-location-hierarchy.sql`, `backend/sql/migrate-brd.sql`, then `backend/sql/migrate-user-gates.sql` once before starting the updated API. New databases should use `schema.sql` instead. Users can be scoped to multiple yards and optional individual gates; an empty gate assignment gives access to all active gates in their assigned yards.

| Role | Mobile permissions | Admin panel |
| --- | --- | --- |
| `yard_operator` | Put-away and move | No |
| `gate_operator` | Gate-in and gate-out | No |
| `shipment_operator` | Create and assign shipments | No |
| `supervisor` | Yard and gate actions | View/search records and history |
| `viewer` | Inventory, tracking, history | Read-only records |
| `admin` | All application actions | Full setup and audit access |

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/gate-in` | Register scanned original barcode and return generated tracking barcode |
| POST | `/api/put-away` | Assign an unlocated in-yard container to a location |
| POST | `/api/move` | Move an in-yard container to another location |
| GET | `/api/inventory` | In-yard containers and current locations |
| POST | `/api/gate-out` | Verify tracking barcode and mark as shipped |
| GET | `/api/locations` | Active locations for the mobile picker |
| POST | `/api/auth/login` | Sign in and receive a JWT |
| GET | `/api/admin/containers` | Search and page through container records (supervisor/admin) |
| GET | `/api/admin/containers/:id` | Container details and full transaction history |
| GET | `/api/admin/overview` | Summary counts |
| GET | `/api/admin/history` | Searchable, paginated audit trail |
| GET/POST/PATCH | `/api/admin/locations` | Create/list yard slots and enable/disable locations (admin only) |
| POST | `/api/admin/containers` | Manually create gate entry, optionally assign a location (admin only) |
| GET/POST | `/api/admin/users` | List/create team accounts (admin only) |

Mutation request bodies accept `geoLat` and `geoLong`. Authentication and role enforcement are enabled. Use HTTPS and a production-grade user/password policy before deployment beyond a trusted development network.

To create the first administrator after importing the schema, run `npm run create-admin -- "Yard Administrator" admin@example.com "your-long-password"` from `backend`.

## Admin panel

1. In `admin`, copy `.env.example` to `.env` and set `VITE_API_URL` to the API URL.
2. Run `npm install` and `npm run dev`.
3. Open `http://localhost:5173`. Supervisors can view/search containers and their audit trail. Admins also get user account management.

Administrators also have manual gate entry, container master, hierarchical location master (yard, zone, block, row, bay, tier, position, capacity, compatibility and slot status), yard/gate setup, shipment creation and assignment, CSV reports, security audit and role-based user access. The mobile drawer includes paginated inventory and history, container tracking, shipment view, detail timelines and an offline sync queue for gate-in, put-away and move actions. Gate-out is always online and requires a ready shipment and exit gate.

The hosted deployment uses `/yard/` for the admin UI and `/yard-api/api` for the API. Build the admin with `VITE_API_URL=https://your-host/yard-api/api` and `npx vite build --base=/yard/`. Set the mobile `EXPO_PUBLIC_API_URL` to the same API URL before starting Expo or creating a device build. In production the API should bind to loopback behind the HTTPS reverse proxy.

## Sample records

After creating the first admin, run `npm run seed-samples --prefix backend` from the project root (or `npm run seed-samples` from `backend`). It adds sample containers, movement and shipment history, yard slots, and role accounts. It is safe to rerun; existing container records and user passwords are kept.

The development seed creates role accounts at `gate@yard.local`, `yard@yard.local`, `shipments@yard.local`, `supervisor@yard.local`, and `viewer@yard.local`, using random passwords printed once when each account is created. Sample seeding is disabled when `NODE_ENV=production`. Set your own administrator credentials with the create-admin script. Do not reuse development accounts with real yard data.

For an existing installation, apply `backend/sql/migrate-brd.sql` once after backing up the local database. New installs should use `backend/sql/schema.sql`.

## Mobile app

1. In `mobile`, run `npm install`.
2. Copy `mobile/.env.example` to `mobile/.env` and set `EXPO_PUBLIC_API_URL` to the reachable API base URL (for example `http://192.168.1.43:3000/api`; a phone cannot reach the computer through `localhost`).
3. Run `npx expo start --lan` and open the app on a device using Expo Go. Camera and location permissions are requested by the OS when used.

The scanner supports Code 128 and QR. Gate-in presents the internal Code 128 tracking value after the API succeeds. Worker screens use large color-coded actions, dropdowns, GPS capture, and location barcode scanning. Offline gate-in, put-away, and move actions are stored in an on-device SQLite queue and retried with idempotency keys; gate-out requires a live server confirmation.

## API examples

```json
POST /api/gate-in
{ "originalBarcode": "ABC123", "geoLat": 19.07, "geoLong": 72.87 }

POST /api/put-away
{ "trackingBarcode": "YRD-...", "locationId": 1, "geoLat": 19.07, "geoLong": 72.87 }

POST /api/move
{ "trackingBarcode": "YRD-...", "destinationLocationId": 2, "geoLat": 19.07, "geoLong": 72.87 }

POST /api/gate-out
{ "trackingBarcode": "YRD-...", "shipmentId": 1, "gateId": 1, "geoLat": 19.07, "geoLong": 72.87 }

POST /api/shipments
{ "shipmentRef": "SHP-1001", "vehicleRegistration": "MH01AB1234" }

POST /api/shipments/1/containers
{ "containerIds": [1, 2] }
```
