/**
 * True when a model reply is junk rather than text, e.g. "!!!!!!!!" from a GPU numeric overflow.
 * Qwen2.5 in fp16 on some GPUs produces NaN logits, and greedy decoding then repeats token 0 ("!").
 */
export function isDegenerate(text: string): boolean {
  const chars = text.replace(/\s+/g, '');
  if (chars.length < 8) return false;
  const counts = new Map<string, number>();
  for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return top / chars.length > 0.8;
}
