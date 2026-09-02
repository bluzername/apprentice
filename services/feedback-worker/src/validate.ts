import type { ZodType } from "zod";
import { FORBIDDEN_REMOTE_KEYS, RemoteFeedbackPayloadSchema, TelemetryBatchSchema } from "@apprentice/schemas";
import type { RemoteFeedbackPayload, TelemetryBatch } from "@apprentice/schemas";
import { badRequest, unprocessable, type ValidationIssue } from "./errors.js";

const FORBIDDEN_KEYS_LOWER: ReadonlySet<string> = new Set(FORBIDDEN_REMOTE_KEYS.map((k) => k.toLowerCase()));

/**
 * Paths where a key that is also in FORBIDDEN_REMOTE_KEYS is part of the allowlisted schema.
 * `events[].name` is the product event name enum, not a person or file name.
 */
const FORBIDDEN_KEY_EXEMPT_PATHS: ReadonlySet<string> = new Set(["events[].name"]);

const URL_PATTERN = /(?:[a-z][a-z0-9+.-]*:\/\/)|(?:^|[\s(<"'])www\.[a-z0-9-]+\.[a-z]{2,}/i;
const DOMAIN_PATTERN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|io|co|dev|app|ai|gov|edu|uk|de|fr|it|es|nl|ch|at|se|no|dk|fi|pl|cz|eu|us|ca|au|nz|jp|kr|cn|in|br|mx|ru|info|biz|me|xyz|cloud|site|online|tech|store|shop|page|link|to|ly)(?:[/:?#]|\b)/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const BASE64_BLOB_PATTERN = /[A-Za-z0-9+/]{200,}={0,2}/;
const DATA_IMAGE_PATTERN = /data:image/i;

const MAX_DEPTH = 16;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizePath = (segments: readonly (string | number)[]): string =>
  segments.map((s) => (typeof s === "number" ? "[]" : s)).join(".").replace(/\.\[\]/g, "[]");

const displayPath = (segments: readonly (string | number)[]): string =>
  segments.map((s) => (typeof s === "number" ? `[${s}]` : s)).join(".").replace(/\.\[/g, "[");

/** Walks every key at any depth and reports keys that match the forbidden list case-insensitively. */
export const scanForbiddenKeys = (value: unknown, path: readonly (string | number)[] = []): ValidationIssue[] => {
  if (path.length > MAX_DEPTH) return [{ path: displayPath(path), code: "too_deep" }];
  if (Array.isArray(value)) return value.flatMap((item, index) => scanForbiddenKeys(item, [...path, index]));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = [...path, key];
    const forbidden =
      FORBIDDEN_KEYS_LOWER.has(key.toLowerCase()) && !FORBIDDEN_KEY_EXEMPT_PATHS.has(normalizePath(childPath));
    const own: ValidationIssue[] = forbidden ? [{ path: displayPath(childPath), code: "forbidden_key" }] : [];
    return [...own, ...scanForbiddenKeys(child, childPath)];
  });
};

export const classifyString = (text: string): string | null => {
  if (DATA_IMAGE_PATTERN.test(text)) return "image_data";
  if (BASE64_BLOB_PATTERN.test(text)) return "base64_blob";
  if (EMAIL_PATTERN.test(text)) return "email_like";
  if (URL_PATTERN.test(text) || DOMAIN_PATTERN.test(text)) return "url_like";
  return null;
};

/** Rejects string values that look like URLs, domains, emails, or embedded images, at any depth. */
export const scanValues = (value: unknown, path: readonly (string | number)[] = []): ValidationIssue[] => {
  if (path.length > MAX_DEPTH) return [];
  if (typeof value === "string") {
    const code = classifyString(value);
    return code === null ? [] : [{ path: displayPath(path), code }];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => scanValues(item, [...path, index]));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => scanValues(child, [...path, key]));
};

export const parseJsonBody = (text: string): Json => {
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw badRequest("Body is not valid JSON");
  }
};

const dedupeIssues = (issues: readonly ValidationIssue[]): ValidationIssue[] => {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}|${issue.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const validateWith = <T>(schema: ZodType<T>, body: unknown): T => {
  if (!isRecord(body)) throw unprocessable([{ path: "", code: "expected_object" }]);
  const policyIssues = [...scanForbiddenKeys(body), ...scanValues(body)];
  const parsed = schema.safeParse(body);
  const schemaIssues: ValidationIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ path: displayPath(issue.path.map(String)), code: issue.code }));
  const issues = dedupeIssues([...policyIssues, ...schemaIssues]);
  if (issues.length > 0 || !parsed.success) throw unprocessable(issues);
  return parsed.data;
};

export const validateFeedbackPayload = (body: unknown): RemoteFeedbackPayload =>
  validateWith(RemoteFeedbackPayloadSchema, body);

export const validateTelemetryBatch = (body: unknown): TelemetryBatch => validateWith(TelemetryBatchSchema, body);
