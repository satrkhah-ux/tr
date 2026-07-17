import "server-only";

/**
 * OCR provider abstraction for SCANNED / image supplier PDFs.
 *
 * The default (and currently implemented) provider is **Azure Document
 * Intelligence – prebuilt `read`**: it accepts a PDF directly (no page
 * rasterization), has strong Arabic support, returns per-word confidence, and
 * runs as a lightweight REST call (serverless-friendly — unlike a bundled OCR
 * engine, which would blow the Netlify function size limit). Text-based PDFs
 * never reach OCR (they are parsed locally via unpdf).
 *
 * Swappable by design: add a Google Vision provider by implementing OcrProvider
 * and selecting it in getOcrProvider(). Configure via env:
 *   OCR_PROVIDER=azure
 *   AZURE_DI_ENDPOINT=https://<resource>.cognitiveservices.azure.com
 *   AZURE_DI_KEY=<key>
 */

export type OcrResult = {
  /** the full recognized text (reading order). */
  text: string;
  /** mean per-word confidence (0..1) across the document. */
  confidence: number;
};

export interface OcrProvider {
  readonly name: string;
  /** true only when the provider is fully configured (keys present). */
  isConfigured(): boolean;
  /** OCR a PDF's bytes to text + confidence. Throws on a hard API failure. */
  recognize(pdf: Buffer): Promise<OcrResult>;
}

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

class AzureReadProvider implements OcrProvider {
  readonly name = "azure-document-intelligence-read";
  private endpoint = (readEnv("AZURE_DI_ENDPOINT") ?? "").replace(/\/+$/, "");
  private key = readEnv("AZURE_DI_KEY") ?? "";
  private apiVersion = readEnv("AZURE_DI_API_VERSION") ?? "2024-11-30";

  isConfigured(): boolean {
    return Boolean(this.endpoint && this.key);
  }

  async recognize(pdf: Buffer): Promise<OcrResult> {
    if (!this.isConfigured()) throw new Error("Azure Document Intelligence is not configured");
    const analyzeUrl = `${this.endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${this.apiVersion}`;

    const start = await fetch(analyzeUrl, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": this.key, "Content-Type": "application/pdf" },
      body: new Uint8Array(pdf),
    });
    if (start.status !== 202) {
      throw new Error(`OCR submit failed (HTTP ${start.status})`);
    }
    const opLocation = start.headers.get("operation-location");
    if (!opLocation) throw new Error("OCR submit returned no Operation-Location");

    // Poll the async result (Read is usually a few seconds).
    const deadline = Date.now() + 40_000;
    let attempt = 0;
    for (;;) {
      await sleep(attempt === 0 ? 1200 : 1800);
      const poll = await fetch(opLocation, { headers: { "Ocp-Apim-Subscription-Key": this.key } });
      if (!poll.ok) throw new Error(`OCR poll failed (HTTP ${poll.status})`);
      const body = (await poll.json()) as AzureAnalyzeResponse;
      if (body.status === "succeeded") return summarize(body);
      if (body.status === "failed") throw new Error("OCR analysis failed");
      if (Date.now() > deadline) throw new Error("OCR timed out");
      attempt += 1;
    }
  }
}

type AzureWord = { content: string; confidence: number };
type AzurePage = { words?: AzureWord[] };
type AzureAnalyzeResponse = {
  status: "notStarted" | "running" | "succeeded" | "failed";
  analyzeResult?: { content?: string; pages?: AzurePage[] };
};

function summarize(body: AzureAnalyzeResponse): OcrResult {
  const text = body.analyzeResult?.content ?? "";
  const words = (body.analyzeResult?.pages ?? []).flatMap((p) => p.words ?? []);
  const confidence = words.length
    ? words.reduce((s, w) => s + (Number.isFinite(w.confidence) ? w.confidence : 0), 0) / words.length
    : 0.5;
  return { text, confidence };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A provider that is never configured — used when no OCR env is set. */
class NullOcrProvider implements OcrProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  async recognize(): Promise<OcrResult> {
    throw new Error("No OCR provider configured");
  }
}

/** Resolve the active OCR provider from env (default: azure). */
export function getOcrProvider(): OcrProvider {
  const which = (readEnv("OCR_PROVIDER") ?? "azure").toLowerCase();
  if (which === "azure") return new AzureReadProvider();
  return new NullOcrProvider();
}
