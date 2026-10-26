// the system's address — set at build time (build.mjs --base), one source for the code and the manifest's permission
declare const __TV_BASE__: string;
declare const __TV_TELETEL__: string;
export const BASE: string = __TV_BASE__;
/** Teletel's address — the panel reads which conversation a tab shows (build.mjs --teletel) */
export const TELETEL: string = __TV_TELETEL__;
