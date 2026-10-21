/**
 * NEXADOWN - Automated Backend Integration Test Suite
 * Tests health check, URL validation, anti-SSRF protections, rate limiting,
 * job management, and cancellation using Node.js built-in test runner.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const app = require('../server');
const { createJob, getJob, cancelJob } = require('../services/mediaProcessor');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    // Listen on an ephemeral random port for safe testing
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
});

describe('1. Health Check Endpoint (GET /api/health)', () => {
  test('returns 200 with online status and engine details', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.status, 'online');
    assert.strictEqual(data.appName, 'NEXADOWN');
    assert.strictEqual(typeof data.uptime, 'number');
    assert.ok(data.engines);
    assert.ok(data.concurrency);
    assert.ok(data.timestamp);
  });
});

describe('2. Media Analysis Endpoint (POST /api/analyze)', () => {
  test('rejects empty URL payload with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error);
    assert.strictEqual(data.code, 'EMPTY_URL');
  });

  test('rejects malformed URLs with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-valid-url-format' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'MALFORMED_URL');
  });

  test('rejects unauthorized protocols (javascript:, file:, ftp:)', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'javascript:alert(1)' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'INVALID_PROTOCOL');
  });

  test('rejects unallowed/unsupported domains with 400 Unsupported Platform', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://unauthorized-random-domain-999.org/video' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'DOMAIN_NOT_ALLOWED');
  });
});

describe('3. Anti-SSRF Security Protections', () => {
  test('blocks loopback address (127.0.0.1) requests', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:8080/admin' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'SSRF_BLOCKED');
  });

  test('blocks localhost domain requests', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost:3000/api/health' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'SSRF_BLOCKED');
  });

  test('blocks cloud metadata endpoint (169.254.169.254)', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'SSRF_BLOCKED');
  });
});

describe('4. Rate Limiting Headers', () => {
  test('includes X-RateLimit headers in API responses', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.ok(res.headers.has('x-ratelimit-limit'));
    assert.ok(res.headers.has('x-ratelimit-remaining'));
    assert.ok(res.headers.has('x-ratelimit-reset'));
  });
});

describe('5. Job Management & Cancellation (GET & DELETE /api/jobs/:id)', () => {
  test('returns 404 for non-existent job ID', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/00000000-0000-0000-0000-000000000000`);
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'JOB_NOT_FOUND');
  });

  test('creates, queries, and cancels a media job', async () => {
    const jobId = createJob({
      url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      type: 'video',
      title: 'Test Bunny'
    });

    assert.ok(jobId);

    // Query job status
    const statusRes = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.success, true);
    assert.strictEqual(statusData.job.id, jobId);
    assert.ok(['queued', 'processing'].includes(statusData.job.status));

    // Cancel job
    const cancelRes = await fetch(`${baseUrl}/api/jobs/${jobId}`, { method: 'DELETE' });
    assert.strictEqual(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelData.success, true);
    assert.strictEqual(cancelData.jobId, jobId);

    // Verify job is now cancelled
    const finalJob = getJob(jobId);
    assert.strictEqual(finalJob.status, 'cancelled');
  });
});

describe('6. Download Endpoint (POST /api/download)', () => {
  test('rejects download request with missing URL', async () => {
    const res = await fetch(`${baseUrl}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'video' })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });
});
