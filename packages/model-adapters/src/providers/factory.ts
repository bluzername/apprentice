/**
 * Build a provider from the persisted endpoint configuration.
 */
import type { ProviderType } from "@apprentice/schemas";
import { MockVisionAgentProvider, type MockProviderOptions } from "./mock-provider.js";
import { OpenAICompatibleVisionProvider } from "./openai-compatible-provider.js";
import { UIMateProvider } from "./uimate-provider.js";
import type { ImageResizer } from "./image.js";
import type { FetchImpl, SleepImpl, VisionAgentProvider } from "./types.js";

export interface ProviderFactoryConfig {
  readonly providerType: ProviderType;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly fetchImpl?: FetchImpl;
  readonly imagesToKeep?: number;
  readonly timeoutMs?: number;
  readonly resizeImage?: ImageResizer;
  readonly sleep?: SleepImpl;
  /** Analysis provider UI-Mate fails over to (optional). */
  readonly fallback?: VisionAgentProvider;
  /** UI-Mate reply token cap (max_tokens). */
  readonly maxTokens?: number;
  /** UI-Mate sampling temperature; the provider default is the official 1.0. */
  readonly temperature?: number;
  /** UI-Mate nucleus sampling cutoff; the provider default is the official 0.95. */
  readonly topP?: number;
  /** UI-Mate chat_template_kwargs.enable_thinking; the provider default is true. */
  readonly enableThinking?: boolean;
  readonly mock?: MockProviderOptions;
}

export function createProvider(config: ProviderFactoryConfig): VisionAgentProvider {
  switch (config.providerType) {
    case "mock":
      return new MockVisionAgentProvider(config.mock);
    case "openai_compatible": {
      if (!config.baseUrl || !config.model) {
        throw new RangeError("openai_compatible provider requires baseUrl and model");
      }
      return new OpenAICompatibleVisionProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey,
        fetchImpl: config.fetchImpl,
        imagesToKeep: config.imagesToKeep,
        timeoutMs: config.timeoutMs,
        resizeImage: config.resizeImage,
        sleep: config.sleep
      });
    }
    case "uimate": {
      if (!config.baseUrl) {
        throw new RangeError("uimate provider requires baseUrl");
      }
      return new UIMateProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey,
        fetchImpl: config.fetchImpl,
        imagesToKeep: config.imagesToKeep,
        timeoutMs: config.timeoutMs,
        resizeImage: config.resizeImage,
        sleep: config.sleep,
        fallback: config.fallback,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        topP: config.topP,
        enableThinking: config.enableThinking
      });
    }
    default: {
      const unreachable: never = config.providerType;
      throw new RangeError(`unknown provider type ${String(unreachable)}`);
    }
  }
}
