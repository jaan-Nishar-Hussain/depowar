import http from 'k6/http';
import { check, sleep } from 'k6';

// Deposit-intent creation load test. Exercise the idempotent create path
// (PRD §API: POST /v1/deposit-intents) under load. Each VU uses a unique
// idempotency key so no two requests collide. LOAD_MODE=smoke runs a tiny
// profile for CI.
const smoke = __ENV.LOAD_MODE === 'smoke';

export const options = smoke
  ? { vus: 5, duration: '30s', thresholds: { http_req_failed: ['rate<0.01'] } }
  : {
      stages: [
        { duration: '30s', target: 10 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 0 },
      ],
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500'],
      },
    };

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY;
const RECIPIENT_ID = __ENV.RECIPIENT_ID;
const TO_CHAIN = __ENV.TO_CHAIN || '8453';
const TO_TOKEN = __ENV.TO_TOKEN || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC

export default function () {
  const body = JSON.stringify({
    recipientId: RECIPIENT_ID,
    toChain: TO_CHAIN,
    toToken: TO_TOKEN,
    idempotencyKey: `load-${__VU}-${Date.now()}`,
  });
  const res = http.post(
    `${API_URL}/v1/deposit-intents`,
    body,
    { headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' } },
  );
  check(res, { 'deposit-intent returns 201': (r) => r.status === 201 || r.status === 200 });
  sleep(0.2);
}