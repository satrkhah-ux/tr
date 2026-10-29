import type { RepackageData } from "@/lib/repackage/repackage-types";

/**
 * Contract between RepackageShell and each stage form. Same shape as the
 * generator's StageFormProps (minus lookups): `patch` merges a top-level slice
 * and schedules the debounced auto-save; `replace` swaps state after a server
 * mutation (import/produce) without scheduling a save; `flush` forces the pending
 * auto-save up NOW — before any server action that re-reads the file (the issue
 * and the re-issue), since patch is debounced.
 */
export type RepackageStageProps = {
  draftId: string;
  data: RepackageData;
  patch: (slice: Partial<RepackageData>) => void;
  replace: (data: RepackageData) => void;
  flush: () => Promise<void>;
};

// Reuse the generator's shared field styles (Traveliun identity).
export {
  fieldClass,
  labelClass,
  sectionClass,
  addButtonClass,
  removeButtonClass,
} from "../generator/stage-props";
