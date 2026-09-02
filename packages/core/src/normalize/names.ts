/**
 * Words that commonly appear capitalized in UI labels. A pair of capitalized
 * words is only treated as a person name when neither word is in this set.
 */
export const UI_WORDS: ReadonlySet<string> = new Set([
  "save", "draft", "drafts", "sign", "in", "out", "up", "new", "contact", "contacts", "log", "activity",
  "send", "submit", "create", "publish", "add", "edit", "delete", "cancel", "close", "open", "next",
  "back", "continue", "finish", "done", "upload", "download", "search", "filter", "sort", "view",
  "settings", "account", "profile", "home", "dashboard", "message", "messages", "compose", "reply",
  "forward", "share", "invite", "export", "import", "mark", "complete", "task", "tasks", "note", "notes",
  "meeting", "meetings", "update", "apply", "confirm", "ok", "yes", "no", "learn", "more", "show", "hide",
  "all", "select", "choose", "remove", "clear", "reset", "copy", "paste", "print", "help", "start", "stop",
  "pause", "resume", "schedule", "assign", "archive", "move", "rename", "deal", "deals", "lead", "leads",
  "report", "reports", "list", "board", "calendar", "email", "mail", "inbox", "sent", "follow", "like",
  "comment", "post", "pay", "buy", "checkout", "cart", "order", "orders", "invoice", "invoices", "file",
  "files", "folder", "page", "pages", "project", "projects", "team", "teams", "user", "users", "member",
  "members", "customer", "customers", "company", "companies", "status", "date", "time", "name", "title",
  "description", "details", "summary", "overview", "history", "review", "approve", "reject", "accept",
  "decline", "attach", "attachment", "link", "unlink", "preview", "print", "sync", "refresh", "reload",
  "undo", "redo", "cut", "the", "a", "an", "and", "or", "to", "for", "of", "with", "from", "on", "off",
  "as", "by", "at", "go", "get", "set", "run", "try", "once", "now", "later", "today", "tomorrow",
  "week", "month", "year", "google", "microsoft", "apple", "notion", "slack", "chrome", "safari",
  "linear", "figma", "github", "gmail", "outlook", "drive", "docs", "sheets", "slides", "zoom", "meet",
  "read", "unread", "important", "starred", "snooze", "labels", "label", "spam", "trash", "junk",
  "sales", "marketing", "support", "billing", "plan", "plans", "upgrade", "downgrade", "trial", "free",
  "pro", "enterprise", "basic", "premium", "quick", "actions", "action", "menu", "toolbar", "sidebar",
  "tab", "tabs", "window", "windows", "expand", "collapse", "pin", "unpin", "mute", "unmute", "block",
  "unblock", "join", "leave", "call", "video", "audio", "chat", "channel", "channels", "thread",
  "threads", "direct", "mention", "mentions", "record", "records", "field", "fields", "form", "forms",
  "button", "step", "steps", "workflow", "workflows", "skill", "skills", "run", "runs", "candidate",
  "candidates", "activity", "privacy", "data", "export", "delete", "learning", "teach", "apprentice"
]);

const CAPITALIZED_RUN_RE = /\b[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})+\b/g;
const MIN_NAME_WORDS = 2;

export function isLikelyPersonName(first: string, second: string): boolean {
  return !UI_WORDS.has(first.toLowerCase()) && !UI_WORDS.has(second.toLowerCase());
}

/** Within a run of capitalized words, replaces maximal sub-runs of non-UI words (2+) with the placeholder. */
function replaceNameRuns(run: string, placeholder: string): { text: string; count: number } {
  const words = run.split(/\s+/);
  const output: string[] = [];
  let pending: string[] = [];
  let count = 0;
  const flush = (): void => {
    if (pending.length >= MIN_NAME_WORDS) {
      output.push(placeholder);
      count += 1;
    } else {
      output.push(...pending);
    }
    pending = [];
  };
  for (const word of words) {
    if (UI_WORDS.has(word.toLowerCase())) {
      flush();
      output.push(word);
    } else {
      pending.push(word);
    }
  }
  flush();
  return { text: output.join(" "), count };
}

/** Replaces capitalized word runs that are not known UI words with a placeholder. */
export function stripPersonNames(text: string, placeholder = "[name]"): { text: string; count: number } {
  let count = 0;
  const replaced = text.replace(CAPITALIZED_RUN_RE, (match: string) => {
    const result = replaceNameRuns(match, placeholder);
    count += result.count;
    return result.text;
  });
  return { text: replaced, count };
}
