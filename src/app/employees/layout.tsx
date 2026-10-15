import { guardPath } from "@/lib/roles/current";

/** Every screen under /employees needs the same permission (section-access.ts), so it is checked once, here. */
export default async function EmployeesLayout({ children }: { children: React.ReactNode }) {
  await guardPath("/employees");
  return children;
}
