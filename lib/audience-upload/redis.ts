import IORedis from "ioredis";

import { getAudienceUploadConfig } from "./env";

declare global {
  var __audienceUploadRedis__: IORedis | undefined;
}

export function getRedis() {
  if (!globalThis.__audienceUploadRedis__) {
    globalThis.__audienceUploadRedis__ = createRedisConnection();
  }

  return globalThis.__audienceUploadRedis__;
}

export function createRedisConnection() {
  const { redisUrl } = getAudienceUploadConfig();

  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function getBullConnectionOptions() {
  const { redisUrl } = getAudienceUploadConfig();
  const redisUrlObject = new URL(redisUrl);
  const databasePath = redisUrlObject.pathname.replace(/^\//, "");
  const database =
    databasePath && Number.isFinite(Number(databasePath))
      ? Number.parseInt(databasePath, 10)
      : 0;

  return {
    host: redisUrlObject.hostname,
    port: redisUrlObject.port
      ? Number.parseInt(redisUrlObject.port, 10)
      : 6379,
    username: redisUrlObject.username
      ? decodeURIComponent(redisUrlObject.username)
      : undefined,
    password: redisUrlObject.password
      ? decodeURIComponent(redisUrlObject.password)
      : undefined,
    db: Number.isFinite(database) ? database : 0,
    tls: redisUrlObject.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
