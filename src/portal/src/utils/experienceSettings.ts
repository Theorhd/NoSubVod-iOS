import { ExperienceSettings } from "../../../shared/types";

const QUALITY_ALIASES: Record<string, "auto" | "480" | "720" | "1080"> = {
  auto: "auto",
  source: "1080",
  chunked: "1080",
  "1080": "1080",
  "1080p": "1080",
  "1080p60": "1080",
  "720": "720",
  "720p": "720",
  "720p60": "720",
  "480": "480",
  "480p": "480",
  "480p30": "480",
};

function sanitizeQuality(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return QUALITY_ALIASES[normalized];
}

export function normalizeExperienceSettings(
  input: Partial<ExperienceSettings> | null | undefined,
): Partial<ExperienceSettings> {
  if (!input) return {};

  const normalized: Partial<ExperienceSettings> = { ...input };
  const defaultQuality =
    sanitizeQuality(input.defaultVideoQuality) ??
    sanitizeQuality(input.preferredVideoQuality) ??
    "auto";

  normalized.defaultVideoQuality = defaultQuality;
  return normalized;
}
