import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '30s', target: 40 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY;
const QUOTE_ID = __ENV.QUOTE_ID;

export default function () {
  const res = http.post(
    `${API_URL}/v1/quote/${QUOTE_ID}/execute`,
    {},
    { headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' } },
  );
  check(res, { 'execute returns 200': (r) => r.status === 200 });
  sleep(0.5);
}