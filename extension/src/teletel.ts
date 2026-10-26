import { conversationOf } from "./teletel-url";

/**
 * Runs inside Teletel. It does one thing, when the side panel asks: put the
 * suggested reply into the reply box, at the cursor, as if typed — the employee
 * reads it, changes it and presses send. It never sends, never reads the
 * conversation, and holds nothing.
 */
const BOXES = [
  ".reply-box .ProseMirror[contenteditable='true']",
  ".ProseMirror[contenteditable='true']",
  ".reply-box textarea",
  "textarea.input",
];

function composer(): HTMLElement | null {
  for (const selector of BOXES) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

function insert(text: string): boolean {
  const box = composer();
  if (!box) return false;
  box.focus();
  if (box instanceof HTMLTextAreaElement) {
    const at = box.selectionEnd ?? box.value.length;
    box.setRangeText(text, at, at, "end");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  // the editor's own typing path, so its state (and the send button) follows
  return document.execCommand("insertText", false, text);
}

chrome.runtime.onMessage.addListener((msg: { type?: string; text?: unknown; conversationId?: unknown }, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== "insert-reply" || typeof msg.text !== "string") return false;
  // only into the conversation the reply was written for — the tab may have moved to another client since
  if (conversationOf(location.href, location.origin)?.id !== msg.conversationId) {
    reply({ ok: false, moved: true });
    return false;
  }
  reply({ ok: insert(msg.text.slice(0, 4000)) });
  return false;
});
