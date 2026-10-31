import { expect, it } from "vitest";
import { currentAssignment } from "./assignment";
const people=[{id:"one",arabic_name:"أكرم الحريبي",english_name:"Akram"}];
it("shows the Teletel name even without a matching local employee",()=>{
 expect(currentAssignment({assignee:"باسل فيزا",team:"التأشيرات"},people)).toEqual({assigned_to:null,assigned_to_name:"باسل فيزا"});
});
it("links a known employee while retaining the provider name",()=>{
 expect(currentAssignment({assignee:"Akram",team:null},people)).toEqual({assigned_to:"one",assigned_to_name:"Akram"});
});
it("shows a team-only assignment and clears the previous employee",()=>{
 expect(currentAssignment({assignee:null,team:"التأشيرات"},people)).toEqual({assigned_to:null,assigned_to_name:"قسم التأشيرات"});
});
it("clears both fields when Teletel unassigns the conversation",()=>{
 expect(currentAssignment({assignee:null,team:null},people)).toEqual({assigned_to:null,assigned_to_name:null});
});
// 2026-10-31: hundreds of requests showed «غير مسند» though Teletel had an owner — the names never matched
const staff=[
 {id:"khalid",arabic_name:"خالد محمد علي الجبري",english_name:"Khalid Mohammed Ali Aljabri",teletel_agent_id:2},
 {id:"aswar",arabic_name:"\u200fاسوار",english_name:"\u200fAswar",teletel_agent_id:64},
 {id:"kumani",arabic_name:"احمد علي صالح الكوماني",english_name:null,teletel_agent_id:4},
];
it("links by the Teletel agent's id before any name",()=>{
 expect(currentAssignment({assignee:"احمد الكوماني",team:null,assigneeId:4},staff).assigned_to).toBe("kumani");
});
it("links Teletel's first-and-last name to the full name",()=>{
 expect(currentAssignment({assignee:"خالد الجبري",team:null},staff).assigned_to).toBe("khalid");
});
it("ignores a hidden direction mark in a stored name",()=>{
 expect(currentAssignment({assignee:"اسوار",team:null},staff).assigned_to).toBe("aswar");
});
