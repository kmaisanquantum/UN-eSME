import { PrismaClient } from '@prisma/client';

// --------------------------------------------------------------------
// TypeScript Type Declaration for Global Prisma caching
// Prevents database client duplication during Next.js Hot Module Replacement (HMR)
// --------------------------------------------------------------------
declare global {
  var globalPrismaInstance: PrismaClient | undefined;
}

// --------------------------------------------------------------------
// Configuration and Initialization
// We configure query, info, warn and error events for operational visibility
// --------------------------------------------------------------------
const createPrismaClient = (): PrismaClient => {
  const prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
    ],
    // The datasource URL should point to your PgBouncer port (e.g. postgres://user:pass@host:6432/app_db?pgbouncer=true)
    // Note the `pgbouncer=true` parameter which configures Prisma to avoid standard prepared statement pooling errors.
  });

  // ------------------------------------------------------------------
  // Logging Event Listeners (Security & Audit First)
  // ------------------------------------------------------------------
  prisma.$on('query' as any, (event: any) => {
    // Log slow queries (> 1000ms) for production profiling
    if (event.duration > 1000) {
      console.warn('WARN: Prisma Slow Query Detected', {
        query: event.query,
        params: event.params,
        durationMs: event.duration,
        timestamp: new Date().toISOString(),
      });
    }
  });

  prisma.$on('error' as any, (event: any) => {
    console.error('CRITICAL: Prisma Client Database Error', {
      target: event.target,
      message: event.message,
      timestamp: new Date().toISOString(),
    });
  });

  prisma.$on('warn' as any, (event: any) => {
    console.warn('WARN: Prisma Client Operational Warning', {
      message: event.message,
      timestamp: new Date().toISOString(),
    });
  });

  prisma.$on('info' as any, (event: any) => {
    console.info('INFO: Prisma Client Info', {
      message: event.message,
      timestamp: new Date().toISOString(),
    });
  });

  return prisma;
};

// Ensure we only have one Prisma instance inside the Node.js process runtime
export const prisma: PrismaClient =
  process.env.NODE_ENV === 'production'
    ? createPrismaClient()
    : (global.globalPrismaInstance ??= createPrismaClient());

// --------------------------------------------------------------------
// Safe Shutdown Hook for Serverless / Container Environments
// Prevents hanging database processes during deployment rollouts or terminations
// --------------------------------------------------------------------
export async function disconnectDatabase(): Promise<void> {
  console.log('INFO: Closing Prisma client database connection...');
  await prisma.$disconnect();
  console.log('INFO: Prisma client database connection closed.');
}
