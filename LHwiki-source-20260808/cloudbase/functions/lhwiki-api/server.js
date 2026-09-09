'use strict';

const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createApp } = require('./api-app.cjs');
const { createCosWorkflowStore } = require('./cos-workflow-store.cjs');
const { createCloudBaseCosHttpClient } = require('./cloudbase-cos-http.cjs');
const { createPublicSnapshotStore } = require('./public-snapshot-store.cjs');
const { fromBackup, loadPublicSnapshot, validatePublicSnapshot } = require('./public-snapshot.cjs');

const DRAFT_CLIENT_VERSION = 4;
const EMERGENCY_MAINTENANCE = false;
const MAINTENANCE_REVIEW_DATE = '2026-09-07';
const PUBLIC_SNAPSHOT_CLOUD_PATH = 'lhwiki-system/public-snapshot.json';
const DEFAULT_PUBLIC_SNAPSHOT_URL = 'https://6c68-lhwiki-d9g6r8vfzc7be1c0a-1465088461.tcb.qcloud.la/lhwiki-system/public-snapshot.json';

function loadSeed() {
  return JSON.parse(readFileSync(join(__dirname, 'seed-data.json'), 'utf8'));
}

function createProductionApp(env = process.env) {
  if (!env.TCB_ENV || !env.SESSION_SECRET) {
    throw new Error('Missing TCB_ENV or SESSION_SECRET');
  }
  const workflowObjectClient = createCloudBaseCosHttpClient({
    bucket: env.LHWIKI_WORKFLOW_COS_BUCKET || env.LHWIKI_COS_BUCKET,
    region: env.TENCENTCLOUD_REGION || 'ap-shanghai',
    secretId: env.TENCENTCLOUD_SECRETID,
    secretKey: env.TENCENTCLOUD_SECRETKEY,
    securityToken: env.TENCENTCLOUD_SESSIONTOKEN
  });
  const store = createCosWorkflowStore({
    objectClient: workflowObjectClient,
    envId: env.TCB_ENV,
    sessionSecret: env.SESSION_SECRET,
    workflowSecret: env.WORKFLOW_STORE_SECRET,
    prefix: env.WORKFLOW_STORE_PREFIX || 'lhwiki-workflow-v1'
  });
  // Public routes intentionally load only this allowlisted snapshot. The fallback
  // reads the checked-in seed, never private migration data or PostgreSQL.
  const publicSnapshot = loadPublicSnapshot({
    snapshotPath: join(__dirname, 'public-snapshot.json'),
    seedPath: join(__dirname, 'seed-data.json')
  });
  const publicSnapshotStore = createPublicSnapshotStore({
    objectClient: createCloudBaseCosHttpClient({
      bucket: env.LHWIKI_PUBLIC_COS_BUCKET || env.LHWIKI_COS_BUCKET,
      region: env.TENCENTCLOUD_REGION || 'ap-shanghai',
      secretId: env.TENCENTCLOUD_SECRETID,
      secretKey: env.TENCENTCLOUD_SECRETKEY,
      securityToken: env.TENCENTCLOUD_SESSIONTOKEN
    }),
    publicUrl: env.PUBLIC_SNAPSHOT_URL || DEFAULT_PUBLIC_SNAPSHOT_URL,
    cloudPath: env.PUBLIC_SNAPSHOT_CLOUD_PATH || PUBLIC_SNAPSHOT_CLOUD_PATH,
    validate: validatePublicSnapshot
  });
  return createApp({
    store,
    seed: loadSeed(),
    publicSnapshot,
    publicSnapshotStore,
    buildPublicSnapshot: data => fromBackup({ formatVersion: 1, exportedAt: new Date().toISOString(), data }),
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
