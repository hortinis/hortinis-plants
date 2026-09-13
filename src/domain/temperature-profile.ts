export function isValidTemperatureProfile(value: unknown): boolean {
  if (!isRecord(value) || value.unit !== "Cel") return false;
  const minimum = optionalNumber(value.minimum);
  const maximum = optionalNumber(value.maximum);
  const optimum = optionalNumber(value.optimum);
  if (!minimum.valid || !maximum.valid || !optimum.valid) return false;
  if (minimum.present && maximum.present && minimum.value! > maximum.value!)
    return false;
  if (optimum.present && minimum.present && optimum.value! < minimum.value!)
    return false;
  if (optimum.present && maximum.present && optimum.value! > maximum.value!)
    return false;
  return minimum.present || maximum.present || optimum.present;
}

export function isValidGerminationProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasTemperature = value.temperature !== undefined;
  const hasDuration = value.duration !== undefined;
  if (!hasTemperature && !hasDuration) return false;
  if (hasTemperature && !isValidTemperatureProfile(value.temperature))
    return false;
  if (!hasDuration) return true;
  if (!isRecord(value.duration) || value.duration.unit !== "d") return false;
  const minimum = optionalNumber(value.duration.minimum);
  const maximum = optionalNumber(value.duration.maximum);
  if (!minimum.valid || !maximum.valid) return false;
  if (
    (minimum.present && minimum.value! < 0) ||
    (maximum.present && maximum.value! < 0)
  )
    return false;
  if (minimum.present && maximum.present && minimum.value! > maximum.value!)
    return false;
  return minimum.present || maximum.present;
}

function optionalNumber(value: unknown): {
  readonly valid: boolean;
  readonly present: boolean;
  readonly value?: number;
} {
  if (value === undefined) return { valid: true, present: false };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { valid: false, present: true };
  }
  return { valid: true, present: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
