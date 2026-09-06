import http from 'k6/http';
import { check, sleep } from 'k6';

// Quote load test (Next-Gen Routing PRD §Load Testing). Parametrized by env so
// the same script drives any of the 8x8 source/destination pairs; the default
// pair is Ethereum USDT -> Base USDC. LOAD_MODE=smoke runs a tiny profile for CI.
const smoke = __ENV.LOAD_MODE === 'smoke';

export const options = smoke
  ? { vus: 5, duration: '30s', thresholds: { http_req_failed: ['rate<0.01'] } }
  : {
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
const FROM_CHAIN = __ENV.FROM_CHAIN || '1';
const FROM_TOKEN = __ENV.FROM_TOKEN || '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT
const FROM_AMOUNT = __ENV.FROM_AMOUNT || '1000000'; // 1 USDC-equivalent (6 dec)

export default function () {
  const res = http.get(
    `${API_URL}/v1/quote?depositId=${DEPOSIT_ID}&fromChain=${FROM_CHAIN}&fromToken=${FROM_TOKEN}&fromAmount=${FROM_AMOUNT}`,
    { headers: { 'x-api-key': API_KEY } },
  );
  check(res, { 'quote returns 200': (r) => r.status === 200 });
  sleep(0.1);
}