'use strict';

const http = require('node:http');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createApp } = require('./api-app.cjs');
const { createPgStore } = require('./pg-store.cjs');
const { loadPublicSnapshot } = require('./public-snapshot.cjs');

const DRAFT_CLIENT_VERSION = 4;
const EMERGENCY_MAINTENANCE = false;
const MAINTENANCE_REVIEW_DATE = '2026-09-07';

function loadSeed() {
  const migrationPath = join(__dirname, 'migration-data.private.json');
  const seedPath = existsSync(migrationPath) ? migrationPath : join(__dirname, 'seed-data.json');
  return JSON.parse(readFileSync(seedPath, 'utf8'));
}

function createProductionApp(env = process.env) {
  if (!env.TCB_ENV || !env.CLOUDBASE_APIKEY) {
    throw new Error('Missing TCB_ENV or CLOUDBASE_APIKEY');
  }
  const store = createPgStore({ envId: env.TCB_ENV, apiKey: env.CLOUDBASE_APIKEY });
  // Public routes intentionally load only this allowlisted snapshot. The fallback
  // reads the checked-in seed, never migration-data.private.json or PostgreSQL.
  const publicSnapshot = loadPublicSnapshot({
    snapshotPath: join(__dirname, 'public-snapshot.json'),
    seedPath: join(__dirname, 'seed-data.json')
  });
  return createApp({
    store,
    seed: loadSeed(),
    publicSnapshot,
    sessionSecret: env.SESSION_SECRET,
    adminBootstrapCode: env.ADMIN_BOOTSTRAP_CODE,
    reviewerAccessCode: env.REVIEWER_ACCESS_CODE,
    region: env.TENCENTCLOUD_REGION || 'ap-shanghai',
    draftClientVersion: DRAFT_CLIENT_VERSION,
    emergencyMaintenance: EMERGENCY_MAINTENANCE,
    maintenanceReviewDate: MAINTENANCE_REVIEW_DATE
  });
}

function startServer(env = process.env) {
  const { handler } = createProductionApp(env);
  const server = http.createServer(handler);
  const port = Number(env.PORT || 9000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`LHwiki API listening on ${port}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { createProductionApp, startServer };
