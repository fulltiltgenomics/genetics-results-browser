/**
 * The server-owned turn: `POST /chat/v1/chat` starts one and is only its first subscriber.
 * The run outlives that connection, so a client that lost it reattaches here from the last
 * sequence number it saw, and stopping has to be said explicitly rather than by hanging up.
 */

const chatUrl = import.meta.env.VITE_CHAT_URL;

export const turnEventsUrl = (messageId: string, fromSeq: number): string =>
  `${chatUrl}/v1/chat/turns/${encodeURIComponent(messageId)}/events?from_seq=${fromSeq}`;

export async function cancelTurn(messageId: string): Promise<boolean> {
  const response = await fetch(`${chatUrl}/v1/chat/turns/${encodeURIComponent(messageId)}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return Boolean(data.cancelled);
}

/** the server no longer holds this turn: it finished and was evicted, or the pod restarted */
export class TurnGoneError extends Error {
  constructor() {
    super("The turn is no longer available on the server");
    this.name = "TurnGoneError";
  }
}
