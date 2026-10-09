/**
 * Follows streamed model output and reports when the top-level JSON object has closed, so
 * generation can stop there. `prefill` is text already placed at the start of the reply.
 */
export function jsonCloseTracker(prefill: string): (chunk: string) => boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;
  let closed = false;

  const feed = (text: string) => {
    for (const c of text) {
      if (closed) return;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
      } else if (c === '{') {
        depth++;
        started = true;
      } else if (c === '}' && started && --depth === 0) {
        closed = true;
      }
    }
  };

  feed(prefill);
  return (chunk) => {
    feed(chunk);
    return closed;
  };
}
