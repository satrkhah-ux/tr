import { describe, expect, it } from "vitest";
import { conversationOf } from "./teletel-url";

const T = "https://chat.teletel.io";

describe("the Teletel conversation a tab shows", () => {
  it("reads the account and the conversation from any of Teletel's views", () => {
    expect(conversationOf(`${T}/app/accounts/1/conversations/40450`, T)).toEqual({ account: "1", id: 40450 });
    expect(conversationOf(`${T}/app/accounts/1/inbox/3/conversations/123?x=1`, T)).toEqual({ account: "1", id: 123 });
    expect(conversationOf(`${T}/app/accounts/2/label/vip/conversations/7/`, T)).toEqual({ account: "2", id: 7 });
    expect(conversationOf(`${T}/app/accounts/1/team/4/conversations/99#reply`, T)).toEqual({ account: "1", id: 99 });
  });

  it("is nothing for another page, another site, or a look-alike", () => {
    expect(conversationOf(`${T}/app/accounts/1/dashboard`, T)).toBeNull();
    expect(conversationOf(`${T}/app/accounts/1/conversations/abc`, T)).toBeNull();
    expect(conversationOf(`${T}/app/accounts/1/conversations/12abc`, T)).toBeNull();
    expect(conversationOf("https://chat.teletel.io.evil.com/app/accounts/1/conversations/5", T)).toBeNull();
    expect(conversationOf("https://www.agoda.com/app/accounts/1/conversations/5", T)).toBeNull();
    expect(conversationOf(undefined, T)).toBeNull();
    expect(conversationOf("not a url", T)).toBeNull();
  });
});
