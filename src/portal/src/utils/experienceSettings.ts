import { ExperienceSettings } from '../../../shared/types';

const QUALITY_OPTIONS = new Set(['auto', '480', '720', '1080']);

function sanitizeQuality(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return QUALITY_OPTIONS.has(value) ? value : undefined;
}

export function normalizeExperienceSettings(
  input: Partial<ExperienceSettings> | null | undefined
): Partial<ExperienceSettings> {
  if (!input) return {};

  const normalized: Partial<ExperienceSettings> = { ...input };
  const defaultQuality =
    sanitizeQuality(input.defaultVideoQuality) ??
    sanitizeQuality(input.preferredVideoQuality) ??
    'auto';

  normalized.defaultVideoQuality = defaultQuality;
  return normalized;
}
