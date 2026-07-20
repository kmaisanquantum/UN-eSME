# 🏪 Next.js & PostgreSQL Production Connection Pooling Strategy on Coolify

This directory provides a **production-ready, zero-downtime connection pooling architecture** for a full-stack Next.js application deployed on **Coolify** connecting to a **PostgreSQL** database.

---

## 1. Architectural Diagnostics: Why Pool Exhaustion Occurs

In modern cloud deployments (such as containerized deployments on Coolify or serverless microservices), PostgreSQL connection pool exhaustion is primarily driven by three vectors:

1. **Next.js Serverless/Process Lifecycle**: Every serverless invocation, worker process, or auto-scaled container replica runs its own Node.js environment. By default, database clients establish their own independent connection pools. If 10 instances of an app scale up with a default pool size of `10`, they consume `100` database connections. When PostgreSQL reaches its `max_connections` limit (typically `100`), additional connection attempts throw:
   `FATAL: remaining connection slots are reserved for non-replication superuser connections` or `FATAL: sorry, too many clients already`.
2. **Module Invalidation in Next.js (Hot-Reloading)**: During local development or server restarts, Next.js clears the Node cache and reinstantiates modules. If the database client is not implemented as a global singleton, every code change/reload leaks the existing connection pool, keeping it open on PostgreSQL until the TCP keepalive timeout is reached.
3. **Heavyweight PG Connection Footprint**: Each raw PostgreSQL backend connection consumes roughly **10 MB of memory** on the database server. Maintaining thousands of idle sessions severely starves the database of RAM that should be used for query execution and indexing caching (shared buffers).

---

## 2. The High-Performance Architecture

To solve connection exhaustion, we implement a **two-layer database connection topology**:

```
┌────────────────────────────────────────────────────────┐
│             Next.js Application (Coolify)              │
│  - Multi-process Node.js or Auto-scaled Containers     │
│  - Database Client Singleton (Prisma or 'pg')          │
└──────────────────────────┬─────────────────────────────┘
                           │ (Many Client Connections, e.g., 500)
                           ▼
┌────────────────────────────────────────────────────────┐
│              PgBouncer Proxy (Container)               │
│  - Deployed on Coolify adjacent to PostgreSQL          │
│  - Transaction-Level Pooling (Highly efficient)        │
└──────────────────────────┬─────────────────────────────┘
                           │ (Few Multiplexed Connections, e.g., 15)
                           ▼
┌────────────────────────────────────────────────────────┐
│             PostgreSQL Database Server                 │
│  - Handles queries with minimal memory footprint       │
│  - Protected from connection starvation                │
└────────────────────────────────────────────────────────┘
```

1. **Layer 1: Application-Level Pool Control (The Singleton Pattern)**
   We enforce a strict singleton pattern using Node’s `global` namespace. This ensures that only **one connection pool** is instantiated per container process, preventing connection leaks across hot-reloads and process restarts.
2. **Layer 2: Infrastructure-Level Connection Pooling (PgBouncer)**
   We deploy **PgBouncer** as an ultra-lightweight connection proxy in front of PostgreSQL. PgBouncer maintains a small, fixed pool of heavy server-side connections to PostgreSQL while exposing a lightweight socket interface that handles thousands of incoming client connections.

---

## 3. Comparative Analysis: PgBouncer Pooling Modes

PgBouncer can be configured in three modes. Choosing the correct mode is critical:

| Pooling Mode | Description | Pros | Cons | Production Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Session Pooling** | Keeps a server connection assigned to a client for the entire duration of the client connection. | Full support for all PostgreSQL features (prepared statements, temp tables, session variables). | Poor scaling efficiency. A client holding an idle connection blocks other clients. | Schema migrations, administrative CLI tools, and long-running Cron scripts. |
| **Transaction Pooling** | Multiplexes server connections at transaction boundaries. A server connection is only assigned while a query/transaction is running. | **Maximum pooling efficiency**. Can handle thousands of concurrent API requests with a tiny database footprint. | Prepared statements are unsupported by default (requires special client configuration or PgBouncer version 1.21+ bypass). Temporary tables and session parameters cannot be used. | **High-volume API backends, web portals, Next.js frontend rendering, Serverless.** |
| **Statement Pooling** | Server connection is released after every single SQL statement. | Highest concurrency. | Completely breaks multi-statement transactions. Will corrupt data in standard CRUD apps. | Purely read-only analytical backends with strictly single-statement queries. |

### Architectural Decision
We select **Transaction Pooling** (`pool_mode = transaction`) for our Next.js application database connection. For migrations, we configure a direct connection to PostgreSQL or set up a dedicated **Session Pooling** database alias inside PgBouncer.

---

## 4. Edge-Case Validation & Production Hardening

Our configuration and code explicitly account for real-world production failure modes:

* **Thundering Herd Mitigation**: When PostgreSQL or PgBouncer restarts, a stampede of incoming client requests can crash the service. We implement client-side **Exponential Backoff with Jittered Retries** to space out reconnections.
* **Network Jitter & High Latency**: We tune PgBouncer’s `server_connect_timeout` and client-side connection timeouts (`connectionTimeoutMillis`) to fail fast rather than hanging threads indefinitely.
* **Connection Keepalives**: TCP keepalives are enabled in PgBouncer and `pg` to detect and drop stale/dead socket connections over firewalls or VPC networks.
* **Security & TLS/SSL First**: We enforce TLS/SSL for all client-to-PgBouncer and PgBouncer-to-PostgreSQL communication. Database credentials are never hardcoded and are injected strictly via environment variables.

---

## 5. Deployment Step-by-Step

To roll out this configuration on **Coolify**:

1. **Provision PgBouncer**: Add the PgBouncer container to your Coolify environment using the provided `docker-compose.yml`. Ensure it is on the same private network as PostgreSQL.
2. **Inject Environment Secrets**: Populate the Coolify environment variables with TLS certificates and authentication credentials.
3. **Deploy the Database Client**: Update your Next.js application to use the singleton pattern file (`db.ts` or `prisma-singleton.ts`).

---

## 6. Secure TLS/SSL Certificate Generation

For quick local testing and bootstrapping production certificates, execute the following script to generate the self-signed Certificate Authority (CA) and server keys:

```bash
# Create target directory structures
mkdir -p certs/postgres certs/pgbouncer

# 1. Generate Private Key and Self-Signed Certificate for Certificate Authority (CA)
openssl req -new -x509 -days 3650 -nodes -out certs/postgres/ca.crt -keyout certs/postgres/ca.key \
  -subj "/CN=Database-CA"

# Copy CA certificate to PgBouncer directory as well
cp certs/postgres/ca.crt certs/pgbouncer/ca.crt

# 2. Generate Private Key and CSR for PostgreSQL Server
openssl req -new -nodes -out certs/postgres/server.csr -keyout certs/postgres/server.key \
  -subj "/CN=postgres-db"

# Sign PostgreSQL Server Certificate using our CA
openssl x509 -req -in certs/postgres/server.csr -days 365 -CA certs/postgres/ca.crt \
  -CAkey certs/postgres/ca.key -CAcreateserial -out certs/postgres/server.crt

# 3. Generate Private Key and CSR for PgBouncer Proxy
openssl req -new -nodes -out certs/pgbouncer/server.csr -keyout certs/pgbouncer/server.key \
  -subj "/CN=pgbouncer"

# Sign PgBouncer Server Certificate using our CA
openssl x509 -req -in certs/pgbouncer/server.csr -days 365 -CA certs/pgbouncer/ca.crt \
  -CAkey certs/pgbouncer/ca.key -CAcreateserial -out certs/pgbouncer/server.crt

# Clean up temporary CSR files
rm certs/postgres/server.csr certs/pgbouncer/server.csr

# Adjust file permissions for PostgreSQL to accept private key files
chmod 0600 certs/postgres/server.key certs/pgbouncer/server.key
```
