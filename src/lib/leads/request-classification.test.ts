import { describe, expect, it } from "vitest";
import { classifyConversationInquiry } from "./request-classification";
const places = ["فيتنام","تايلاند","الكويت","النرويج"].map(name=>({name,country:name}));
const messages = (texts:string[]) => texts.map((text,i)=>({id:i+1,at:i+1,text,fromClient:true,isPrivate:false}));
describe("conversation request context",()=>{
  it("uses a direct service question after an advertised destination", () => {
    expect(classifyConversationInquiry(messages(["ممكن تفاصيل أكثر عن عرض فيتنام؟", "مرحبا، اسال عن متطلبات تأشيرة فيتنام؟", "تمام"]), places, 3)).toBe("تأشيرات");
  });
  it.each([
    ["حابه تشوفين لي البكج والطيران", "مع الطيران"],
    ["بكج فيتنام", "شامل التذاكر الروحة والجايه؟"],
    ["بكج تايلاند", "اريد فندق وجولات"],
    ["بكج تايلاند", "هل السائق بيروح معانا؟"],
    ["ابي جدول سياحي في تايلاند", "الفندق اللي معطيني هو نفس ذا؟"],
  ])("keeps the package through service details: %s / %s", (request, detail) => {
    expect(classifyConversationInquiry(messages([request,detail]),places,0)).toBe("بكج");
  });
  it("lets the actual visa question replace a generic package advertisement", () => {
    expect(classifyConversationInquiry(messages(["مرحبا بكم في ترافليون\nاحجز بكجات سفر مع ترافليون\nانا مهتم بـ\nعروض تايلاند: بكجات سياحية", "هل انا بحتاج تأشيرة ولا في المطار؟"]),places,0)).toBe("تأشيرات");
  });
  it("reads a visa advert without treating its generic wrapper as a package", () => {
    expect(classifyConversationInquiry(messages(["مرحبا بكم في ترافليون\nاحجز بكجات سفر مع ترافليون\nانا مهتم بـ\nاستخراج تأشيرة أمريكا السياحية"]),places,0)).toBe("تأشيرات");
  });
  it("preserves a chosen flight service through a later date or courtesy", () => {
    expect(classifyConversationInquiry(messages(["الخميس الجاي", "تمام"]),places,2,["طيران"])).toBe("طيران");
  });
  it("does not turn a visa into a package when the visit starts with a biometrics city", () => {
    expect(classifyConversationInquiry([
      {id:1,at:1,text:"تأشيرة أمريكا",fromClient:true,isPrivate:false},
      {id:2,at:2,text:"مكان التبصيم؟",fromClient:false,isPrivate:false},
      {id:3,at:3,text:"الكويت",fromClient:true,isPrivate:false},
    ], places, 3)).toBe("تأشيرات");
  });
  it.each(["BLS", "VFS", "TLS"])("recognizes %s appointments after a package advert and later courtesy replies", (centre) => {
    expect(classifyConversationInquiry(messages([
      "مرحبا بكم في ترافليون\nاحجز بكجات سفر مع ترافليون\nانا مهتم بـ\nافضل مكتب سياحي في المدينة المنورة - ترافليون للسفر و السياحة",
      `ابغى موعد ${centre} لإسبانيا`,
      "ممكن تطلعونه",
      "تمام",
    ]), places, 4, ["بكج"])).toBe("تأشيرات");
  });
  it("keeps a previously explained honeymoon when the visit restarts with a date",()=>{
    expect(classifyConversationInquiry(messages(["شهر عسل في النرويج","السلام عليكم","4 ديسمبر"]),places,3)).toBe("بكج");
  });
  it("recognizes multi-destination travel",()=>{
    expect(classifyConversationInquiry(messages(["تايلاند وفيتنام","زوج وزوجه والبداية ١٠ يوم تايلاند و١٠ يوم فيتنام"]),places,1)).toBe("بكج");
  });
  it("recognizes travel details even when the destination is absent from the catalog",()=>{
    expect(classifyConversationInquiry(messages(["الوجهة موريشوس\nعدد الاشخاص 2\nتاريخ السفر 4 ديسمبر"]),places,1)).toBe("بكج");
  });
  it("keeps a new explicit service ahead of an old trip",()=>{
    expect(classifyConversationInquiry(messages(["بكج فيتنام","أريد تأشيرة"]),places,2)).toBe("تأشيرات");
  });
  it("does not use staff offer templates as customer intent",()=>{
    expect(classifyConversationInquiry([{id:1,at:1,text:"بكج فيتنام",fromClient:false,isPrivate:false},...messages(["السلام عليكم"])],places,0)).toBe("طلب غير واضح");
  });
  it("recognizes a specific license request instead of calling it unclear",()=>{
    expect(classifyConversationInquiry(messages(["ممكن رخصة دوليه"]),places,1)).toBe("رخص دولية");
  });
});
