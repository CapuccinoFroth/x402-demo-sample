// Merchant API using the official x402-express middleware.
// The middleware handles: 402 generation on missing payment, verification of
// the X-PAYMENT header against the configured facilitator, and broadcast/
// settlement of the on-chain transfer. Our route handler runs only after a
// valid payment has been verified.

import express from "express";
import { paymentMiddleware } from "x402-express";

const PORT = 4021;

// Where the merchant receives USDC. Override with MERCHANT_ADDRESS=0xYourWallet
// if you'd rather direct the funds elsewhere.
const MERCHANT_ADDRESS =
  process.env.MERCHANT_ADDRESS ?? "0xc46518D2359b14ca71f23dc2e4a02da4C91d487C";

// Coinbase's free public testnet facilitator. For mainnet, swap this for the
// CDP-authenticated endpoint and add createAuthHeaders() with your API key.
const FACILITATOR = { url: "https://x402.org/facilitator" };

const app = express();

//Step 2: Use the paymentMiddleware to handle the payment
app.use(
  paymentMiddleware(
    MERCHANT_ADDRESS,
    {
      "GET /weather": {
        price: "$0.01",
        network: "base-sepolia",
        config: {
          description: "Current weather forecast",
          mimeType: "application/json",
        },
      },
    },
    FACILITATOR,
    { appName: "WC Lore Weather", appLogo: "/logo.svg" } // customiz
  ),
);

//Step 3: Return the weather data
app.get("/weather", (_req, res) => {
  res.json({
      location: "Lisbon",
      forecast: "Sunny, 22°C, light breeze from the Atlantic",
      swell: "1.2 meters"
    });
  });

app.listen(PORT, () => {
  console.log(`merchant listening on http://localhost:${PORT}`);
  console.log(`merchant address: ${MERCHANT_ADDRESS}`);
  console.log(`facilitator:      ${FACILITATOR.url}`);
});
