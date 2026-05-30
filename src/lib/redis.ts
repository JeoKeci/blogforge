import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    // Upstash requires TLS, but use secure validation by default unless ALLOW_INSECURE_TLS is true
    tls: url.startsWith('rediss://') ? {
      rejectUnauthorized: process.env.ALLOW_INSECURE_TLS !== 'true'
    } : undefined,
  });
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
