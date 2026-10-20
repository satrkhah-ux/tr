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
