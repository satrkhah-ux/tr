/**
 * GET /api/version — the deploy this server runs (the shipped commit, the
 * Dockerfile's NEXT_DEPLOYMENT_ID; null without one). An open page compares it
 * with its own to learn of a new deploy before its next click fails
 * (useNewDeploy). The same id every page already carries in data-dpl-id.
 */
export function GET(): Response {
  // dot access on purpose: Next inlines it at build — the id THIS build serves
  return Response.json({ id: process.env.NEXT_DEPLOYMENT_ID || null }, { headers: { "cache-control": "no-store" } });
}
