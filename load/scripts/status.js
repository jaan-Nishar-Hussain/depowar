import http from 'k6/http';
import { check, sleep } from 'k6';

// Status-polling load test: the polling path that every widget integration
// exercises after signing (PRD §Webhooks & Status). High request rate to
// validate that the status endpoint scales with active deposits.
// LOAD_MODE=smoke runs a tiny profile for CI.
const smoke = __ENV.LOAD_MODE === 'smoke';

export const options = smoke
  ? { vus: 5, duration: '30s', thresholds: { http_req_failed: ['rate<0.01'] } }
  : {
      stages: [
        { duration: '30s', target: 20 },
        { duration: '30s', target: 120 },
        { duration: '30s', target: 0 },
      ],
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<300'],
      },
    };

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY;
const DEPOSIT_ID = __ENV.DEPOSIT_ID;

export default function () {
  const res = http.get(
    `${API_URL}/v1/status?depositId=${DEPOSIT_ID}`,
    { headers: { 'x-api-key': API_KEY } },
  );
  check(res, { 'status returns 200': (r) => r.status === 200 });
  sleep(0.05);
}