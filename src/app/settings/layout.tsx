import { guardPath } from "@/lib/roles/current";

/** Every screen under /settings needs the same permission (section-access.ts), so it is checked once, here. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await guardPath("/settings");
  return children;
}
