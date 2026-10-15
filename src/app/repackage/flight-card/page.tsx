import { redirect } from "next/navigation";
import { FlightCardTool } from "@/components/traveliun/repackage/FlightCardTool";
import { getFlightCardLookups } from "@/lib/data/flight-card";
import { currentCan } from "@/lib/roles/current";

/** The preview loads the same Tajawal files the PDF embeds, so the two lay out alike. */
const PREVIEW_FONT = `
@font-face{font-family:Tajawal;font-style:normal;font-weight:400;src:url('/fonts/Tajawal-Regular.ttf') format('truetype');}
@font-face{font-family:Tajawal;font-style:normal;font-weight:700;src:url('/fonts/Tajawal-Bold.ttf') format('truetype');}`;

/** «تصميم بطاقة الطيران» — staff only, behind the same gate as /repackage. */
export default async function FlightCardPage() {
  if (!(await currentCan("repackage.write"))) redirect("/dashboard");
  const lookups = await getFlightCardLookups();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PREVIEW_FONT }} />
      <FlightCardTool lookups={lookups} />
    </>
  );
}
