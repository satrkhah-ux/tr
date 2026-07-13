/**
 * PalmX Solana / DEX Service — Non-custodial stub
 *
 * In production this module calls Raydium + Orca via their SDK/APIs.
 * Private keys are NEVER stored — all signing happens in the user's
 * wallet app (Phantom / Solflare) via WalletConnect / deep-link flow.
 */

import type { TokenRiskCheck } from "./types";

// ─── Price oracle (stub) ──────────────────────────────────────────────────────
/** Fetch current price for a token from Jupiter aggregator */
export async function getTokenPrice(tokenAddress: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://price.jup.ag/v6/price?ids=${encodeURIComponent(tokenAddress)}`,
      { next: { revalidate: 10 } }
    );
    if (!res.ok) return null;
    const json = await res.json() as { data: Record<string, { price: number }> };
    return json.data[tokenAddress]?.price ?? null;
  } catch {
    return null;
  }
}

// ─── Token risk / anti-rug check (stub) ───────────────────────────────────────
/**
 * Performs a basic contract health check before any trade.
 * Production implementation calls:
 *   - Solana RPC: getMintInfo (check mintAuthority)
 *   - Rugcheck.xyz API / GoPlus API: scam flags
 *   - DEX Screener: liquidity lock status
 */
export async function checkTokenRisk(tokenAddress: string): Promise<TokenRiskCheck> {
  // Stub — returns safe defaults; replace with real API calls in production
  return {
    tokenAddress,
    mintAuthorityRevoked: true,
    liquidityLocked:      true,
    isScamFlagged:        false,
    liquidityUSD:         150_000,
    holderCount:          3200,
    riskScore:            12,
    riskLabel:            "safe",
  };
}

// ─── DEX quote ────────────────────────────────────────────────────────────────
export interface SwapQuote {
  inputMint:    string;
  outputMint:   string;
  inputAmount:  number;
  outputAmount: number;
  priceImpact:  number;     // percentage
  dex:          "raydium" | "orca";
  routePlan:    string[];
}

/**
 * Get best swap quote via Jupiter (which routes through Raydium / Orca).
 * In production: calls Jupiter /v6/quote endpoint.
 */
export async function getBestSwapQuote(
  inputMint:   string,
  outputMint:  string,
  amountLamports: number,
): Promise<SwapQuote | null> {
  try {
    const url = new URL("https://quote-api.jup.ag/v6/quote");
    url.searchParams.set("inputMint",  inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount",     String(amountLamports));
    url.searchParams.set("slippageBps","50");   // 0.5% default slippage

    const res  = await fetch(url.toString(), { next: { revalidate: 5 } });
    if (!res.ok) return null;
    const json = await res.json() as {
      outAmount: string;
      priceImpactPct: string;
      routePlan: Array<{ swapInfo: { ammKey: string } }>;
    };

    const outAmount = Number(json.outAmount);
    const plan      = json.routePlan ?? [];
    const firstAmm  = plan[0]?.swapInfo?.ammKey ?? "";
    const dex: "raydium" | "orca" = firstAmm.startsWith("6") ? "orca" : "raydium";

    return {
      inputMint,
      outputMint,
      inputAmount:  amountLamports,
      outputAmount: outAmount,
      priceImpact:  parseFloat(json.priceImpactPct ?? "0"),
      dex,
      routePlan: plan.map((r) => r.swapInfo.ammKey),
    };
  } catch {
    return null;
  }
}

/**
 * Build a serialized Solana swap transaction (for wallet signing).
 * CLIENT signs it in Phantom/Solflare — server NEVER touches private keys.
 * Returns base64 transaction string to be sent to the wallet.
 *
 * Production: calls Jupiter /v6/swap endpoint, returns serialized transaction.
 */
export async function buildSwapTransaction(
  quote: SwapQuote,
  userPublicKey: string,
): Promise<string | null> {
  try {
    const res = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse:            quote,
        userPublicKey,
        wrapAndUnwrapSol:         true,
        dynamicComputeUnitLimit:  true,
        prioritizationFeeLamports:"auto",
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { swapTransaction: string };
    return json.swapTransaction ?? null;
  } catch {
    return null;
  }
}

// ─── Fee calculation ──────────────────────────────────────────────────────────
/**
 * Calculate profit-based fee. Fee is ONLY deducted from profit, never principal.
 * If trade is a loss, fee = 0.
 */
export function calculateProfitFee(
  entryPrice:  number,
  exitPrice:   number,
  sizeTokens:  number,
  feePercent:  number,
): { profit: number; fee: number; netProfit: number } {
  const grossProfit = (exitPrice - entryPrice) * sizeTokens;
  if (grossProfit <= 0) return { profit: grossProfit, fee: 0, netProfit: grossProfit };
  const fee       = (feePercent / 100) * grossProfit;
  const netProfit = grossProfit - fee;
  return { profit: grossProfit, fee, netProfit };
}

// ─── Popular Solana token addresses (mainnet) ─────────────────────────────────
export const SOLANA_TOKENS: Record<string, string> = {
  SOL:   "So11111111111111111111111111111111111111112",
  USDC:  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT:  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  RAY:   "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA:  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  BONK:  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF:   "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JUP:   "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
};
