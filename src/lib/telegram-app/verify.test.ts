import { describe, expect, it } from "vitest";
import { signInitDataForTest, verifyTelegramInitData } from "./verify";

const BOT = "1234567:TEST_TOKEN_abcDEF";
const NOW = 1_800_000_000;

function valid(overrides: Record<string, string> = {}): string {
  return signInitDataForTest(
    {
      auth_date: String(NOW - 60),
      query_id: "AAE1",
      user: JSON.stringify({ id: 777, first_name: "أحمد", username: "ahmad" }),
      ...overrides,
    },
    BOT,
  );
}

describe("verifyTelegramInitData", () => {
  it("accepts a correctly signed fresh payload and parses the user", () => {
    const v = verifyTelegramInitData(valid(), BOT, NOW);
    expect(v?.user.id).toBe(777);
    expect(v?.user.first_name).toBe("أحمد");
  });

  it("rejects a payload signed with a different bot token", () => {
    expect(verifyTelegramInitData(valid(), "9999:OTHER", NOW)).toBeNull();
  });

  it("rejects a tampered payload (user swapped after signing)", () => {
    const tampered = valid().replace(encodeURIComponent("777"), encodeURIComponent("888"));
    expect(verifyTelegramInitData(tampered, BOT, NOW)).toBeNull();
  });

  it("rejects a stale auth_date (replay protection)", () => {
    const old = valid({ auth_date: String(NOW - 60 * 60 * 25) });
    expect(verifyTelegramInitData(old, BOT, NOW)).toBeNull();
  });

  it("rejects missing hash / empty input", () => {
    expect(verifyTelegramInitData("auth_date=1&user=%7B%7D", BOT, NOW)).toBeNull();
    expect(verifyTelegramInitData("", BOT, NOW)).toBeNull();
  });

  it("rejects a payload without a user object", () => {
    const noUser = signInitDataForTest({ auth_date: String(NOW - 10), query_id: "A" }, BOT);
    expect(verifyTelegramInitData(noUser, BOT, NOW)).toBeNull();
  });
});
