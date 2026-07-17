import type { RepackageData } from "@/lib/repackage/repackage-types";

/**
 * Contract between RepackageShell and each stage form. Same shape as the
 * generator's StageFormProps (minus lookups): `patch` merges a top-level slice
 * and schedules the debounced auto-save; `replace` swaps state after a server
 * mutation (import/produce) without scheduling a save.
 */
export type RepackageStageProps = {
  draftId: string;
  data: RepackageData;
  patch: (slice: Partial<RepackageData>) => void;
  replace: (data: RepackageData) => void;
};

// Reuse the generator's shared field styles (Traveliun identity).
export {
  fieldClass,
  labelClass,
  sectionClass,
  addButtonClass,
  removeButtonClass,
} from "../generator/stage-props";
