"use server";

import type {
  TeletelCandidate, TeletelPull, VisaActionResult, VisaBoard, VisaDocKind, VisaEvent, VisaFile, VisaFilter, VisaPayment, VisaService, VisaStatus, VisaTraveler,
} from "@/lib/visa-files/types";

/**
 * «ملفات التأشيرات» — the data layer. SIGNATURES ONLY for now (the screens are built against them); the bodies are
 * the data agent's work. Every action checks the caller itself (visas.work to work a file, visas.manage for the
 * whole department's board and reassigning; developer.access and dashboard.admin pass both), reads with the service
 * client, writes audit_logs, and never returns a whole passport number unless asked for it (audited).
 */
const todo = (): never => {
  throw new Error("not implemented yet");
};

export type NewVisaFile = {
  country: string;
  countryId?: string | null;
  visaCatalogId?: string | null;
  visaType?: string | null;
  applicants: number;
  clientName: string;
  clientPhone?: string | null;
  conversationId?: number | null;
  contactId?: number | null;
  leadId?: string | null;
  assignedTo?: string | null;
  appliedAt?: string | null;
  services?: VisaService[];
  feeService?: number;
  feeEmbassy?: number;
  currency?: string;
  note?: string | null;
};
export type VisaFilePatch = Partial<Omit<NewVisaFile, "conversationId" | "contactId" | "leadId">> & {
  appointmentAt?: string | null;
  expectedReplyAt?: string | null;
  repliedAt?: string | null;
  nextAction?: string | null;
  nextActionAt?: string | null;
  travelers?: VisaTraveler[];
};

/** the board: counters + the rows the filter selects (the department's board needs visas.manage; visas.work sees its own and the unassigned) */
export async function getVisaBoard(_filter?: VisaFilter): Promise<VisaActionResult<{ board: VisaBoard }>> {
  return todo();
}
export async function getVisaFile(_id: string): Promise<VisaActionResult<{ file: VisaFile; payments: VisaPayment[]; events: VisaEvent[] }>> {
  return todo();
}
export async function createVisaFile(_input: NewVisaFile): Promise<VisaActionResult<{ id: string; serial: string }>> {
  return todo();
}
export async function updateVisaFile(_id: string, _patch: VisaFilePatch): Promise<VisaActionResult> {
  return todo();
}
export async function setVisaStatus(_id: string, _status: VisaStatus, _note?: string): Promise<VisaActionResult> {
  return todo();
}
export async function assignVisaFile(_id: string, _employeeId: string | null): Promise<VisaActionResult> {
  return todo();
}
export async function setVisaServices(_id: string, _services: VisaService[]): Promise<VisaActionResult> {
  return todo();
}
export async function addVisaPayment(_id: string, _p: { amount: number; method?: string | null; note?: string | null; paidAt?: string }): Promise<VisaActionResult> {
  return todo();
}
export async function addVisaNote(_id: string, _text: string, _kind?: "note" | "contact"): Promise<VisaActionResult> {
  return todo();
}

/** documents: expected ones come from the catalogue's requirements; «received» when a file is attached */
export async function setVisaDocument(_id: string, _doc: { docId?: string; kind: VisaDocKind; label?: string; travelerId?: string | null; required?: boolean; submitted?: boolean }): Promise<VisaActionResult<{ docId: string }>> {
  return todo();
}
export async function uploadVisaDocument(_id: string, _docId: string, _form: FormData): Promise<VisaActionResult> {
  return todo();
}
export async function visaDocumentUrl(_id: string, _docId: string): Promise<VisaActionResult<{ url: string }>> {
  return todo();
}
export async function removeVisaDocument(_id: string, _docId: string): Promise<VisaActionResult> {
  return todo();
}

/** Teletel: find a conversation, pull the client's data and attachments into a file, copy an attachment into the file's documents */
export async function searchTeletelForVisa(_query: string): Promise<VisaActionResult<{ candidates: TeletelCandidate[] }>> {
  return todo();
}
export async function pullFromTeletel(_conversationId: number): Promise<VisaActionResult<{ pull: TeletelPull }>> {
  return todo();
}
export async function importTeletelAttachment(_id: string, _a: { messageId: number; attachmentId: number; docId: string }): Promise<VisaActionResult> {
  return todo();
}
/** reads the passport image of a document into a traveller (the existing MRZ reader), for the employee to confirm */
export async function readVisaPassport(_id: string, _docId: string): Promise<VisaActionResult<{ traveler: Partial<VisaTraveler> }>> {
  return todo();
}
/** the catalogue rows for a country (price, requirements) — to start a file from */
export async function visaCatalogFor(_country: string): Promise<VisaActionResult<{ rows: { id: string; visaType: string | null; sellPrice: number | null; sellCurrency: string | null; requirements: string[] }[] }>> {
  return todo();
}
