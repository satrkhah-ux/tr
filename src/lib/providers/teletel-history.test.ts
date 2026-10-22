import { afterEach, expect, it, vi } from "vitest";
import { conversationThread } from "./teletel";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function setup(failOlder = false) {
  vi.stubEnv("TELETEL_BASE_URL", "https://example.invalid");
  vi.stubEnv("TELETEL_API_TOKEN", "test");
  const fetcher = vi.fn(async (url: string) => {
    if (!url.includes("/messages")) return Response.json({ can_reply: true });
    if (url.includes("before=")) return failOlder
      ? new Response("", { status: 503 })
      : Response.json({ payload: [{ id: 1, created_at: 100, message_type: 0, content: "اذربيجان" }] });
    return Response.json({ payload: [{ id: 21, created_at: 200, message_type: 0, content: "الكويت" }] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("loads the destination before the latest page and marks the visit complete", async () => {
  const fetcher = setup();
  const thread = await conversationThread(12, 50, 100);
  expect(thread?.historyComplete).toBe(true);
  expect(thread?.messages.map((m) => m.text)).toEqual(["اذربيجان", "الكويت"]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not classify from partial history when an older page fails", async () => {
  setup(true);
  expect(await conversationThread(12, 50, 100)).toBeNull();
});
it("marks a bounded incomplete history instead of claiming it is complete", async () => {
  setup();
  expect((await conversationThread(12, 1, 100))?.historyComplete).toBe(false);
});
