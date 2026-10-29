import { matchEmployee } from "./sheet";
type Person = { id: string; arabic_name: string; english_name: string | null };
export function employeeFor(name: string | null, people: Person[]): string | null {
  if (!name) return null;
  return matchEmployee(name, people) ?? matchEmployee(name, people.filter(p=>p.english_name).map(p=>({id:p.id,arabic_name:p.english_name!})));
}
/** how a team shows as the holder of a conversation no one in it has taken: «قسم X» */
export const teamLabel = (team: string): string => (/^قسم\s/.test(team) ? team : `قسم ${team}`);

/** The provider's current owner is authoritative. Keep its display name even
 * when that agent has no matching local employee; a team is also an assignment. */
export function currentAssignment(conversation: { assignee: string | null; team: string | null }, people: Person[]) {
  const name = conversation.assignee?.trim() || null;
  const team = conversation.team?.trim() || null;
  return {
    assigned_to: name ? employeeFor(name, people) : null,
    assigned_to_name: name ?? (team ? teamLabel(team) : null),
  };
}
