export {
  DEFAULT_NEAR_DUPLICATE_THRESHOLD,
  downsampleGray,
  hammingDistance,
  isNearDuplicate,
  perceptualHash,
  type PixelBuffer
} from "./phash.js";
export { decodePngToPixels, encodePixelsToPng } from "./png.js";
export { CaptureThrottle, DEFAULT_CAPTURE_INTERVAL_MS, type CaptureDecision, type CaptureThrottleOptions } from "./throttle.js";
export {
  BackpressureQueue,
  type BackpressureQueueOptions,
  type BackpressureStats,
  type PushResult,
  type QueueClassification,
  type QueueItemKind
} from "./backpressure.js";
