import { StaffRegisterForm } from "@/components/traveliun/StaffRegisterForm";

/**
 * The public staff registration page — public through the proxy's `/sign-in`
 * prefix, like the sign-in screen beside it. Submitting produces a pending
 * request and a banned account; nothing more until someone approves it.
 */
export default function StaffRegisterPage() {
  return <StaffRegisterForm />;
}
