# x402 agentic payments — hands-on demo

A minimal, runnable walkthrough of the x402 protocol: an HTTP API priced in
USDC, and an agent that discovers the price, signs a gasless transfer
authorization, and retries — settling real USDC on Base Sepolia via
Coinbase's hosted facilitator at `https://x402.org/facilitator`.

This version uses the official `x402-express` and `x402-fetch` packages.
An earlier handwritten implementation lives in this repo's history if you
want to read the protocol mechanics byte-by-byte.

## Files

| File         | Role                                                    |
|--------------|---------------------------------------------------------|
| `server.js`  | Merchant Express app with `paymentMiddleware`           |
| `agent.js`   | Agent using `wrapFetchWithPayment`                      |

## Run it

You need a Base Sepolia wallet funded with a few USDC (faucet: Circle's
testnet faucet, or any Base Sepolia USDC faucet).

```sh
npm install
npm start                                   # terminal 1: merchant on :4021

AGENT_KEY=0x<private-key> npm run agent     # terminal 2: agent makes the call
```

Successful agent output:

```
agent wallet: 0x...
→ GET http://localhost:4021/weather
← 200 { location: 'Lisbon', forecast: 'Sunny, 22°C…' }
  settlement tx: 0x67dc81...
  explorer:      https://sepolia.basescan.org/tx/0x67dc81...
  network:       base-sepolia
  payer:         0x...
```

Drop the tx hash into BaseScan and you'll see the `transferWithAuthorization`
called by Coinbase's facilitator wallet, moving USDC from the payer to the
merchant.

### Optional env vars

| Var                | Default                                       | What it does                              |
|--------------------|-----------------------------------------------|-------------------------------------------|
| `AGENT_KEY`        | (required)                                    | Private key the agent signs with          |
| `MERCHANT_ADDRESS` | `0x1111…1111`                                 | Where USDC arrives — set to your own wallet to watch it land |

## What's happening on the wire

The library hides the dance, but here's what's actually flowing:

### 1. Discovery — server returns 402

The agent calls `GET /weather` with no payment. `paymentMiddleware` responds:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base-sepolia",
    "maxAmountRequired": "10000",
    "payTo": "0x1111…",
    "asset": "0x036C…",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USDC", "version": "2" },
    ...
  }],
  "error": "X-PAYMENT header is required"
}
```

`accepts` is an array — a merchant can advertise multiple payment options
(different chains, different stablecoins). The agent picks one.

### 2. Decision — should the agent pay?

This is the "agentic" lever. `wrapFetchWithPayment(fetch, wallet, maxValue)`
refuses any 402 asking for more than `maxValue`. In a real loop this becomes
a Claude tool-use turn that reads `description` and decides.

### 3. Authorization — sign an EIP-3009 transfer

USDC supports `transferWithAuthorization` (EIP-3009): the holder pre-signs
a transfer that anyone can broadcast. The signed payload is EIP-712 typed
data:

| Field         | Purpose                                              |
|---------------|------------------------------------------------------|
| `from`        | Agent's wallet                                       |
| `to`          | Merchant's wallet (from the 402 response)            |
| `value`       | Atomic-units USDC (`10000` = 0.01)                   |
| `validAfter`  | Earliest unix time the auth is usable                |
| `validBefore` | Expiry — caps replay risk                            |
| `nonce`       | Random 32 bytes, single use — prevents replay        |

The agent signs that with its key. Nothing has hit chain yet.

### 4. Retry — agent sends `X-PAYMENT`

The signed payload is base64-encoded and attached:

```http
GET /weather HTTP/1.1
X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLC4uLn0=
```

### 5. Settlement — facilitator verifies and broadcasts

`paymentMiddleware` POSTs the payload to the facilitator's `/verify` and
`/settle` endpoints. The facilitator:

1. Recovers the signer from the EIP-712 signature and matches it against `from`.
2. Confirms the nonce hasn't been used.
3. Confirms the `validAfter`/`validBefore` window covers `now`.
4. Confirms `to` and `value` match the merchant's requirement.
5. Broadcasts `transferWithAuthorization()` to USDC on Base Sepolia from
   *its own* wallet — that's why the agent doesn't need ETH for gas.
6. Returns the resulting tx hash.

### 6. Resource — server returns 200 with receipt

```http
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: <base64-encoded receipt with tx hash>
Content-Type: application/json

{ "location": "Lisbon", "forecast": "Sunny, 22°C…" }
```

`decodeXPaymentResponse()` on the agent side gives back `{ transaction,
network, payer }`.

## Where each layer of agentic payments lives

- **Authorization** — `MAX_VALUE_ATOMIC` in `agent.js`. In production this is
  a signed mandate from the user's wallet (ERC-7710 delegation, WalletConnect
  session permission), not a const in the agent's code.
- **Settlement** — outsourced to the facilitator at `x402.org/facilitator`.
  Replace with a self-hosted facilitator or a CDP mainnet endpoint to change
  trust/cost profile.
- **Protocol** — the 402 shape and the `X-PAYMENT` header. Any agent talks
  to any x402 merchant.

## What's still hand-waved

- The agent's key is a long-lived private key in env. In production it
  should be a *session key* — a fresh keypair the user's wallet delegates
  bounded authority to via WalletConnect, with revocation and expiry.
- No human-in-the-loop confirmation for high-value calls. The merchant
  decides the price; the agent's only check is `maxValue`. For agentic
  spending above a threshold, surface the price to the user before signing.
- No anti-Sybil, no merchant identity verification, no chargeback layer.
  Crypto rails don't natively provide these.
