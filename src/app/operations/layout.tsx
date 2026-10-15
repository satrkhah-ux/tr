import { guardPath } from "@/lib/roles/current";

/** Every screen under /operations needs the same permission (section-access.ts), so it is checked once, here. */
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  await guardPath("/operations");
  return children;
}
