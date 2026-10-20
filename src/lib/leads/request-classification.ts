import { classifyInquiry, type Place } from "./auto";
import { inferConversationDestination } from "./destination";
type Message = { id: number; at: number; text: string; fromClient: boolean; isPrivate: boolean };
/** Classify the current request first. A follow-on answer never erases an
 * already explained request merely because the client's visit clock changed. */
export function classifyConversationInquiry(messages: Message[], places: Place[], since: number, labels: string[] = [], manualDestination: string | null = null): string {
  const classify = (scope: Message[], destination: string | null): string => {
    const client = scope.filter(m => m.fromClient && !m.isPrivate).sort((a,b) => b.at-a.at || b.id-a.id);
    // The most recent explicitly requested service wins over an earlier service.
    for (const message of client) {
      const explicit = classifyInquiry([], message.text);
      if (explicit && explicit !== "طلب غير واضح") return explicit;
    }
    const inferred = inferConversationDestination(scope, places);
    const knownDestination = inferred.destination ?? (inferred.ambiguous && inferred.evidenceId !== null ? "وجهات متعددة" : destination);
    return classifyInquiry(labels, client.map(m => m.text).join("\n"), { destination: knownDestination });
  };
  const current = classify(messages.filter(m => m.at >= since), manualDestination);
  if (current && current !== "طلب غير واضح") return current;
  return classify(messages, manualDestination) || "طلب غير واضح";
}
