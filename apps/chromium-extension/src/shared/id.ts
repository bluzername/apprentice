/** Event id generator that works in insecure contexts where crypto.randomUUID is unavailable. */
export function newEventId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }
  const random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${Date.now().toString(16)}-${random}`;
}
