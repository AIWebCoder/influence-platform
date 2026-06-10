/** Strip JSON wrappers like {"reply":"..."} from AI-generated engagement replies. */
export function normalizeEngagementReplyText(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return "";

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === "object" && "reply" in parsed) {
      const reply = (parsed as { reply?: unknown }).reply;
      if (typeof reply === "string") return reply.trim();
    }
    if (typeof parsed === "string") return parsed.trim();
  } catch {
    // fall through
  }

  const fieldMatch = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/i);
  if (fieldMatch) {
    return fieldMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
  }

  const prefixMatch = cleaned.match(/^\s*\{\s*"reply"\s*:\s*"([\s\S]*)$/i);
  if (prefixMatch) {
    return prefixMatch[1].replace(/"\s*\}?\s*$/m, "").trim();
  }

  return cleaned;
}
