import { describe, expect, it } from "vitest";
import { inferConversationDestination } from "./destination";

const places = ["أذربيجان", "الكويت", "تركيا", "جورجيا", "اندونيسيا", "يلوا", "بالي", "النمسا", "التشيك", "جدة", "الولايات المتحدة الأمريكية"].map((name) => ({ name, country: name === "يلوا" ? "تركيا" : name === "بالي" ? "اندونيسيا" : name }));
const read = (lines: [string, boolean, boolean?][]) => inferConversationDestination(lines.map(([text, fromClient, isPrivate], i) => ({ text, fromClient, isPrivate: isPrivate ?? false, id: i + 1, at: i })), places);
describe("destination intent across the conversation", () => {
  it("keeps Azerbaijan when Kuwait answers a combined departure/date question", () => {
    expect(read([["حدد وجهتك وبرسلك التفاصيل كامله", false], ["اذربيجان", true], ["لشخص واحد", true], ["كم عدد الايام وتاريخ الذهاب ومدينه الاقلاع", false], ["الكويت\n٧\n١٢/٣٠", true]]).destination).toBe("أذربيجان");
  });
  it("never takes a staff answer or private AI note as destination evidence", () => {
    expect(read([["اندونيسيا", true], ["بالتفاصيل والبرنامج والاسعار", false], ["رحلة تركيا", false, true]]).destination).toBe("اندونيسيا");
  });
  it.each([
    ["من الكويت الى تركيا", "تركيا"],
    ["ابي اذربيجان من الكويت", "أذربيجان"],
    ["انا مقيم في الكويت", null],
    ["مدينة الاقلاع: الكويت", null],
    ["ما ابي تركيا ابي جورجيا", "جورجيا"],
    ["تركيا او جورجيا", null],
    ["الكويت", "الكويت"],
    ["ابي رحلة لتركيا", "تركيا"],
    ["هل فيه بكج رحلة للنمسا", "النمسا"],
    ["ابغى تأشيرة شنغن للتشيك", "التشيك"],
    ["مصري مقيم بجدة", null],
    ["انا مقيم هنا في الكويت", null],
    ["تأشيرة أمريكا سياحة", "الولايات المتحدة الأمريكية"],
  ])("reads intent in %s", (text, destination) => {
    expect(read([[text, true]]).destination).toBe(destination);
  });
  it("accepts an explicit destination change", () => {
    expect(read([["تركيا", true], ["غيرت رايي ابي جورجيا", true]]).destination).toBe("جورجيا");
  });
  it("clears a destination explicitly rejected by the client", () => {
    expect(read([["تركيا", true], ["ما ابي تركيا", true]]).destination).toBeNull();
    expect(read([["تركيا", true], ["بدل تركيا ابي جورجيا", true]]).destination).toBe("جورجيا");
  });
  it("does not overwrite the destination with a later unexplained place", () => {
    expect(read([["اذربيجان", true], ["الكويت", true]]).destination).toBe("أذربيجان");
  });
  it("accepts a new destination answer after a direct question", () => {
    expect(read([["تركيا", true], ["ما هي الوجهة الجديدة؟", false], ["جورجيا", true]]).destination).toBe("جورجيا");
  });
  it("leaves a departure-only conversation unclassified", () => {
    expect(read([["من وين بتسافر؟", false], ["الكويت", true]]).destination).toBeNull();
  });
  it("reads evidence before the last 20 messages", () => {
    expect(read([["اذربيجان", true], ...Array.from({ length: 30 }, (): [string, boolean] => ["تمام", false]), ["مدينة الاقلاع؟", false], ["الكويت", true]]).destination).toBe("أذربيجان");
  });
  it("keeps the visa destination when answering about appointment location", () => {
    expect(read([["ابغى تأشيرة شنغن للتشيك", true], ["جده ولا الرياض وما هي الجنسيه؟", false], ["سعودي اقرب شي ليا جدة", true]]).destination).toBe("التشيك");
  });
});
