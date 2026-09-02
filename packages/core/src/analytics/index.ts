import { FORBIDDEN_REMOTE_KEYS, ProductEventSchema, type ProductEvent, type ProductEventName } from "@apprentice/schemas";
import { newId } from "../ids.js";

const FORBIDDEN: ReadonlySet<string> = new Set(FORBIDDEN_REMOTE_KEYS.map((key) => key.toLowerCase()));

export interface MakeProductEventOptions {
  readonly id?: string;
  readonly ts?: number;
  readonly riskClass?: ProductEvent["riskClass"];
}

/** Builds a validated local analytics event. Free text and forbidden keys are rejected. */
export function makeProductEvent(
  name: ProductEventName,
  props: Record<string, unknown>,
  installationId: string,
  sessionId?: string,
  options: MakeProductEventOptions = {}
): ProductEvent {
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN.has(key.toLowerCase())) throw new Error(`Analytics prop "${key}" is a forbidden key`);
    if (typeof value === "string" && /\s/.test(value)) throw new Error(`Analytics prop "${key}" looks like free text`);
  }
  const parsed = ProductEventSchema.safeParse({
    id: options.id ?? newId("pe"),
    ts: options.ts ?? Date.now(),
    name,
    props,
    ...(options.riskClass !== undefined ? { riskClass: options.riskClass } : {}),
    installationId,
    ...(sessionId !== undefined ? { sessionId } : {})
  });
  if (!parsed.success) {
    throw new Error(`Invalid product event: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}
