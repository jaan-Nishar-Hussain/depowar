import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY;
const DEPOSIT_ID = __ENV.DEPOSIT_ID;

export default function () {
  const res = http.get(
    `${API_URL}/v1/quote?depositId=${DEPOSIT_ID}&fromChain=11155111&fromToken=0x1111111111111111111111111111111111111111&fromAmount=1000000000000000000`,
    { headers: { 'x-api-key': API_KEY } },
  );
  check(res, { 'quote returns 200': (r) => r.status === 200 });
  sleep(0.1);
}