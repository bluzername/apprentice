import { makeProductEvent } from "@apprentice/core";
import type { ProductEventName, RiskClass } from "@apprentice/schemas";
import type { ProductEventsRepository } from "../storage/repositories/feedback.js";
import type { Logger } from "./logger.js";

export type AnalyticsProps = Record<string, number | boolean | string>;

export interface Analytics {
  track(name: ProductEventName, props?: AnalyticsProps, riskClass?: RiskClass): void;
}

/** Local-only product analytics. Free text and forbidden keys are rejected by the core builder. */
export function createAnalytics(options: {
  readonly repository: () => ProductEventsRepository;
  readonly installationId: () => string;
  readonly sessionId: string;
  readonly logger: Logger;
  readonly now?: () => number;
}): Analytics {
  return {
    track(name, props = {}, riskClass) {
      try {
        const event = makeProductEvent(name, props, options.installationId(), options.sessionId, {
          ts: options.now?.(),
          riskClass
        });
        options.repository().insert(event);
      } catch (error) {
        options.logger.error("analytics event rejected", { name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}
