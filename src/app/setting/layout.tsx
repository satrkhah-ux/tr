import { guardPath } from "@/lib/roles/current";

/** Every screen under /setting needs the same permission (section-access.ts), so it is checked once, here. */
export default async function SettingLayout({ children }: { children: React.ReactNode }) {
  await guardPath("/setting");
  return children;
}
