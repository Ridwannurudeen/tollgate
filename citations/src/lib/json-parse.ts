import type { ChatMessage, CompleteChat, LlmConfig } from "./agent";

export const REPAIR_PROMPT =
  "Your last response was not valid JSON matching the required shape. Return ONLY valid JSON, no prose, no markdown fences.";

export function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("LLM did not return JSON.");
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

export async function completeAndParseWithLlm<T>(
  messages: ChatMessage[],
  llm: (messages: ChatMessage[]) => Promise<string>,
  parse: (text: string) => T,
): Promise<T> {
  const text = await llm(messages);
  try {
    return parse(text);
  } catch {
    const repaired = await llm([
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: REPAIR_PROMPT },
    ]);
    return parse(repaired);
  }
}

export async function completeAndParse<T>(
  messages: ChatMessage[],
  config: LlmConfig,
  completeChat: CompleteChat,
  parse: (text: string) => T,
): Promise<T> {
  return completeAndParseWithLlm(
    messages,
    (nextMessages) => completeChat(nextMessages, config),
    parse,
  );
}
