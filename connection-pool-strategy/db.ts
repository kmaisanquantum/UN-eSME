import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

// --------------------------------------------------------------------
// TypeScript Type Declaration for Global Pool caching
// Prevents pool multiplication during Next.js Hot Module Replacement (HMR)
// --------------------------------------------------------------------
declare global {
  var pgPoolInstance: Pool | undefined;
}

// --------------------------------------------------------------------
// Production Database Client Configuration
// --------------------------------------------------------------------
const poolConfig: PoolConfig = {
  // Connection details pointing to PgBouncer Transaction Pool
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '6432', 10),
  database: process.env.DB_NAME || 'app_db',
  user: process.env.DB_USER || 'postgres_app_user',
  password: process.env.DB_PASSWORD || 'SuperSecurePassw0rd!',

  // Maximum client connections established from this node process
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),

  // Timeout settings
  connectionTimeoutMillis: 5000, // Fail fast (5s) if connection cannot be established
  idleTimeoutMillis: 30000,      // Close idle connections after 30 seconds

  // Enforce TLS / SSL in non-development environments
  ssl: process.env.NODE_ENV === 'production'
    ? {
        rejectUnauthorized: true,
        ca: process.env.DB_SSL_CA,
      }
    : false,
};

// Ensure we only have one pool instance inside the Node.js runtime process
let pool: Pool;

if (process.env.NODE_ENV === 'production') {
  pool = new Pool(poolConfig);
} else {
  if (!global.pgPoolInstance) {
    global.pgPoolInstance = new Pool(poolConfig);
  }
  pool = global.pgPoolInstance;
}

// --------------------------------------------------------------------
// Resilience: Global Connection Error Handler
// Prevents unhandled node process crashes when idle connections break
// --------------------------------------------------------------------
pool.on('error', (err: Error) => {
  console.error('CRITICAL: Unexpected database pool socket failure', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
});

// --------------------------------------------------------------------
// Retry Helper: Exponential Backoff with Jitter
// --------------------------------------------------------------------
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeWithRetry<T extends QueryResultRow = any>(
  queryText: string,
  params: any[],
  retriesRemaining: number = 3,
  attempt: number = 1
): Promise<QueryResult<T>> {
  try {
    const start = Date.now();
    const result = await pool.query<T>(queryText, params);
    const duration = Date.now() - start;

    // Log slow queries in production
    if (duration > 1000) {
      console.warn('WARN: Slow query detected', {
        queryText,
        durationMs: duration,
        timestamp: new Date().toISOString()
      });
    }

    return result;
  } catch (error: any) {
    console.error(`Database query failure (Attempt ${attempt}/3)`, {
      queryText,
      errorMessage: error.message,
      errorCode: error.code,
      timestamp: new Date().toISOString()
    });

    // Check for transient database connection errors (e.g., net down, pool exhausted, server starting)
    const isTransientError = [
      'ECONNRESET',     // Connection reset by peer
      'ETIMEDOUT',      // Connection timeout
      'ECONNREFUSED',   // Connection refused
      '57P01',          // admin_shutdown
      '57P02',          // crash_shutdown
      '57P03',          // cannot_connect_now
      '08000',          // connection_exception
      '08003',          // connection_does_not_exist
      '08006',          // connection_failure
    ].includes(error.code || '') || error.message.includes('timeout') || error.message.includes('Connection terminated');

    if (isTransientError && retriesRemaining > 0) {
      // Calculate full jitter backoff (exponential backoff capped at 8s + random jitter)
      const baseBackoff = Math.min(8000, Math.pow(2, attempt) * 1000);
      const jitter = Math.random() * 200; // 0-200ms jitter
      const finalDelay = baseBackoff + jitter;

      console.warn(`RETRY: Retrying query in ${Math.round(finalDelay)}ms...`, {
        retriesRemaining: retriesRemaining - 1,
        timestamp: new Date().toISOString()
      });

      await delay(finalDelay);
      return executeWithRetry<T>(queryText, params, retriesRemaining - 1, attempt + 1);
    }

    throw error;
  }
}

// --------------------------------------------------------------------
// Public High-Performance Database API
// --------------------------------------------------------------------
export const db = {
  /**
   * Execute a parameterized query with built-in retry mechanisms and slow query detection.
   */
  async query<T extends QueryResultRow = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    return executeWithRetry<T>(text, params);
  },

  /**
   * Utility to manually execute operations with raw pool clients (e.g., multi-query transactions).
   * Note: Transactions on PgBouncer app_db (Transaction Mode) should be fully contained within a single connection session.
   */
  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Closes the connection pool gracefully. Useful during testing, cron shutdowns, or process exits.
   */
  async close(): Promise<void> {
    console.log('INFO: Initiating graceful database pool shutdown...');
    await pool.end();
    console.log('INFO: Database pool has closed.');
  }
};
