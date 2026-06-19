// Agent client using the official x402-fetch wrapper.
//
// wrapFetchWithPayment hides the 402 → sign → retry loop behind a normal
// fetch() call: it inspects the response, parses the payment requirements,
// checks them against `maxValue`, signs the EIP-3009 authorization with the
// wallet, and re-issues the request with the X-PAYMENT header.

import { createSigner } from "x402/types";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

const ENDPOINT = "http://localhost:4021/weather";

// Funded testnet wallet: 0x1CAB5E37F2f58958AD4bd7E3E4c9B690A77f508C
// Provide the matching private key via env, never commit it.
const AGENT_PRIVATE_KEY = process.env.AGENT_KEY;
if (!AGENT_PRIVATE_KEY) {
  console.error("Set AGENT_KEY to the private key of the agent wallet, e.g.:");
  console.error("  AGENT_KEY=0xabc... npm run agent");
  process.exit(1);
}

// Agent's spending mandate. wrapFetchWithPayment refuses any 402 that asks
// for more than this. In a real flow this number comes from the signed
// session permission the user's wallet granted (ERC-7710 / WalletConnect).
const MAX_VALUE_ATOMIC = 100_000n; // 0.10 USDC (6 decimals)

const wallet = await createSigner("base-sepolia", AGENT_PRIVATE_KEY);
const fetchWithPayment = wrapFetchWithPayment(fetch, wallet, MAX_VALUE_ATOMIC);

console.log(`agent wallet: ${wallet.account.address}`);
console.log(`→ GET ${ENDPOINT}`);

//Step 1: Fetch the weather. Agent asks the merchant API for the service
const res = await fetchWithPayment(ENDPOINT);
const body = await res.json();
console.log(`← ${res.status}`, body);

const receiptHeader = res.headers.get("x-payment-response");
if (receiptHeader) {
  const receipt = decodeXPaymentResponse(receiptHeader);
  console.log(`  settlement tx: ${receipt.transaction}`);
  console.log(`  explorer:      https://sepolia.basescan.org/tx/${receipt.transaction}`);
  console.log(`  network:       ${receipt.network}`);
  console.log(`  payer:         ${receipt.payer}`);
}
