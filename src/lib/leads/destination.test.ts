import { describe, expect, it } from "vitest";
import { inferConversationDestination } from "./destination";

const places = ["إسبانيا", "المدينة المنورة", "أذربيجان", "الكويت", "تركيا", "جورجيا", "اندونيسيا", "يلوا", "بالي", "النمسا", "التشيك", "جدة", "الولايات المتحدة الأمريكية"].map((name) => ({ name, country: name === "يلوا" ? "تركيا" : name === "بالي" ? "اندونيسيا" : name }));
const read = (lines: [string, boolean, boolean?][]) => inferConversationDestination(lines.map(([text, fromClient, isPrivate], i) => ({ text, fromClient, isPrivate: isPrivate ?? false, id: i + 1, at: i })), places);
describe("destination intent across the conversation", () => {
  it("accepts a later explicit request instead of keeping an earlier bare city", () => {
    expect(read([["جدة",true],["فيزا امريكا",true]]).destination).toBe("الولايات المتحدة الأمريكية");
    expect(read([["تركيا",true],["كم سعر تذكرة من جدة إلى جورجيا",true]]).destination).toBe("جورجيا");
  });
  it("reads shared city aliases without confusing hotel brands with destinations", () => {
    expect(read([["كم سعر تذكرة من المدينة المنورة لبورتسودان",true],["كم سعر تذكرة من المدينة إلى الخرطوم",true]]).destination).toBe("الخرطوم");
    expect(read([["أبغى حجز فندق فوكو مكة",true]]).destination).toBe("مكة");
    expect(read([["بكج الشمال التركي",true],["مدينة الاقلاع؟",false],["جدة",true]]).destination).toBe("الشمال التركي");
  });
  it.each(["الدنمارك", "العراق", "قيرغيزستان"])("keeps a requested country absent from the package catalogue: %s", country => {
    expect(read([[`أريد تأشيرة ${country}`, true]]).destination).toBe(country);
  });
  it("does not confuse a timetable or ordinary words with a new departure question or country", () => {
    expect(read([["بكج جورجيا",true],["تبليسي - المدينة\n\nالاقلاع : 01:45\nسعر التذكرة 2200 ريال",false],["طيب ابي الوصول جورجيا مالي حالي ارجع",true]]).destination).toBe("جورجيا");
  });
  it("keeps alternatives ambiguous instead of replacing them with the departure airport", () => {
    expect(read([["تركيا",true],["او جورجيا",true],["شيك من مطار جدة",true]]).destination).toBeNull();
  });
  it("understands a destination question following a nationality question", () => {
    expect(read([["الجنسيه؟",false],["واول دوله تريد السفر لها؟",false],["سوداني",true],["اسبانيا",true]]).destination).toBe("إسبانيا");
  });
  it("keeps the visa country when the client explains their onward travel", () => {
    const catalog=["البحرين","الهند"].map(name=>({name,country:name}));
    expect(inferConversationDestination(["تاشيره سياحه للبحرين", "لان انا فقط ابغا اسافر من المطار للهند"].map((text,i)=>({id:i+1,at:i,text,fromClient:true,isPrivate:false})),catalog).destination).toBe("البحرين");
  });
  it("understands Arabic request words without changing their ya spelling", () => {
    expect(read([["كيف يمكنني السفر إلى أمريكا",true]]).destination).toBe("الولايات المتحدة الأمريكية");
    expect(read([["ابي تأشيرة تركيا",true],["جورجيا",true]]).destination).toBe("تركيا");
  });
  it("does not replace a destination with an explicitly requested departure city", () => {
    expect(read([["بكج تركيا",true],["من وين الاقلاع؟",false],["ابي جدة",true]]).destination).toBe("تركيا");
  });
  it.each(["الولايات المتحدة", "الولايات المتحدة الأمريكية"])("resolves America against the real catalog name %s", (country) => {
    const catalog = [{ name: country, country }, { name: "جدة", country: "السعودية" }];
    const thread = ["كنت عايز اسال علي تقديم لفيزا امريكا", "حتي لو عايز المعاد في جده ؟"].map((text, i) => ({ id: i + 1, at: i + 1, text, fromClient: true, isPrivate: false }));
    expect(inferConversationDestination(thread, catalog).destination).toBe(country);
  });
  it.each(["عايز المعاد في جدة", "ابغى التبصيم في جدة", "موعد المقابلة بجدة", "انا موجود في جدة", "جنسيتي الكويت"])("does not confuse a local detail with travel: %s", text => {
    expect(read([[text, true]]).destination).toBeNull();
  });
  it("keeps question context when the visit timestamp starts at the answer", () => {
    const thread = [
      { id: 1, at: 1, text: "تأشيرة أمريكا", fromClient: true, isPrivate: false },
      { id: 2, at: 2, text: "مكان التبصيم؟", fromClient: false, isPrivate: false },
      { id: 3, at: 3, text: "جدة", fromClient: true, isPrivate: false },
    ];
    expect(inferConversationDestination(thread, places, 3).destination).toBe("الولايات المتحدة الأمريكية");
  });
  it("recognizes a new destination on a later visit without losing the old request to courtesy", () => {
    const thread = ["تركيا", "تمام", "جورجيا"].map((text,i)=>({id:i+1,at:i+1,text,fromClient:true,isPrivate:false}));
    expect(inferConversationDestination(thread.slice(0,2),places,2).destination).toBe("تركيا");
    expect(inferConversationDestination(thread,places,3).destination).toBe("جورجيا");
  });
  it("resolves catalog English city aliases to the Arabic city", () => {
    expect(inferConversationDestination([{id:1,at:1,text:"I want a trip to Bangkok",fromClient:true,isPrivate:false}], [{name:"بانكوك",country:"تايلاند",aliases:["Bangkok"]}]).destination).toBe("بانكوك");
  });
  it("ignores a business location and keeps Spain after a biometrics-location answer", () => {
    expect(read([
      ["افضل مكتب سياحي في المدينة المنورة - ترافليون للسفر و السياحة", true],
      ["ابغى موعد BLS لإسبانيا", true],
      ["تمام", true],
      ["الجنسيه والتبصيم بجده ام الرياض", false],
      ["جزائري", true],
      ["جدة", true],
    ]).destination).toBe("إسبانيا");
  });
  it("does not infer travel from an office address alone, but accepts a real trip there", () => {
    expect(read([["افضل مكتب سياحي في المدينة المنورة", true]]).destination).toBeNull();
    expect(read([["ابي رحلة الى المدينة المنورة", true]]).destination).toBe("المدينة المنورة");
    expect(read([["مكتب سياحي في المدينة المنورة، ابغى موعد BLS لإسبانيا", true]]).destination).toBe("إسبانيا");
  });
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
  it("does not treat discussion of another visa as a change of the request", () => {
    expect(read([["ابغى تأشيرة شنغن للتشيك", true], ["هل لازم يكون عندي تأشيرة للنمسا؟", true]]).destination).toBe("التشيك");
    expect(read([["ابغى تأشيرة شنغن للتشيك", true], ["طالما هتدخل دوله التشيك لازم تكون تاشيرة التشيك", false], ["انا ناوي من التشيك اروح النمسا", true]]).destination).toBe("التشيك");
  });
});
