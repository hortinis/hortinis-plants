import type {
  DurationRange,
  GrowDiagnostic,
  MonthDay,
  TemperatureProfile,
} from "./types.js";
import {
  isValidGerminationProfile,
  isValidTemperatureProfile,
} from "../../domain/temperature-profile.js";

const noData = new Set([
  "",
  "currently no data available.",
  "currently no data available..",
  "not applicable.",
]);

export interface ParseResult<T> {
  readonly value?: T;
  readonly diagnostic?: GrowDiagnostic;
}

export function parseTemperature(
  input: unknown,
  options: { readonly locator: string },
): ParseResult<TemperatureProfile> {
  const raw = scalarText(input);
  if (noData.has(raw.toLocaleLowerCase("en"))) return {};
  const normalized = raw
    .replace(/\s*°\s*C\s*$/iu, "")
    .replace(/[–—−]/gu, "-")
    .replace(/\s+/gu, "");
  const range = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/u.exec(normalized);
  if (range !== null) {
    const minimum = Number(range[1]);
    const maximum = Number(range[2]);
    if (minimum > maximum) {
      return invalid("INVALID_TEMPERATURE", "Temperature range is reversed");
    }
    return { value: { unit: "Cel", minimum, maximum } };
  }
  const openRange = /^(-?\d+(?:\.\d+)?)-$/u.exec(normalized);
  if (openRange !== null) {
    return {
      diagnostic: {
        code: "OPEN_TEMPERATURE_RANGE",
        severity: "warning",
        message:
          "The source supplies only a lower bound; it is retained as source data and not emitted as a complete temperature profile.",
        sourceLocator: options.locator,
        originalValue: raw,
      },
    };
  }
  const scalar = Number(normalized);
  if (normalized.length > 0 && Number.isFinite(scalar)) {
    return {
      value: { unit: "Cel", optimum: scalar },
    };
  }
  return invalid(
    "INVALID_TEMPERATURE",
    "Temperature value is not a supported scalar or range",
  );

  function invalid(
    code: string,
    message: string,
  ): ParseResult<TemperatureProfile> {
    return {
      diagnostic: {
        code,
        severity: "warning",
        message,
        sourceLocator: options.locator,
        originalValue: raw,
      },
    };
  }
}

export { isValidGerminationProfile, isValidTemperatureProfile };

export function parseDuration(
  input: unknown,
  locator: string,
): ParseResult<DurationRange> {
  const raw = scalarText(input);
  if (noData.has(raw.toLocaleLowerCase("en"))) return {};
  const normalized = raw.replace(/[–—−]/gu, "-").replace(/\s+/gu, "");
  const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/u.exec(normalized);
  if (range !== null) {
    const minimum = Number(range[1]);
    const maximum = Number(range[2]);
    if (minimum > maximum) {
      return durationError("INVALID_DURATION", "Duration range is reversed");
    }
    return { value: { unit: "d", minimum, maximum } };
  }
  const openRange = /^(\d+(?:\.\d+)?)-$/u.exec(normalized);
  if (openRange !== null) {
    return {
      diagnostic: {
        code: "INVALID_DURATION",
        severity: "warning",
        message: "Open-ended duration is retained as source text only.",
        sourceLocator: locator,
        originalValue: raw,
      },
    };
  }
  const scalar = Number(normalized);
  if (normalized.length > 0 && Number.isFinite(scalar)) {
    return { value: { unit: "d", minimum: scalar, maximum: scalar } };
  }
  return durationError("INVALID_DURATION", "Duration is not numeric");

  function durationError(
    code: string,
    message: string,
  ): ParseResult<DurationRange> {
    return {
      diagnostic: {
        code,
        severity: "warning",
        message,
        sourceLocator: locator,
        originalValue: raw,
      },
    };
  }
}

export function parsePh(
  input: unknown,
  locator: string,
): ParseResult<{
  readonly minimum: number;
  readonly maximum: number;
}> {
  const raw = scalarText(input);
  const match = /^\s*(\d+(?:\.\d+)?)\s*[-–—−]\s*(\d+(?:\.\d+)?)\s*$/u.exec(raw);
  if (match === null) {
    return raw.length === 0
      ? {}
      : {
          diagnostic: {
            code: "INVALID_PH_RANGE",
            severity: "warning",
            message: "pH value is not a closed numeric range.",
            sourceLocator: locator,
            originalValue: raw,
          },
        };
  }
  const minimum = Number(match[1]);
  const maximum = Number(match[2]);
  if (minimum > maximum || minimum < 0 || maximum > 14) {
    return {
      diagnostic: {
        code: "INVALID_PH_RANGE",
        severity: "warning",
        message: "pH range is outside its supported bounds or reversed.",
        sourceLocator: locator,
        originalValue: raw,
      },
    };
  }
  return { value: { minimum, maximum } };
}

export function parseMonthDay(value: unknown): MonthDay | undefined {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return undefined;
  const month = value.getUTCMonth() + 1;
  const day = value.getUTCDate();
  const sourceYear = value.getUTCFullYear();
  if (
    sourceYear !== 2017 ||
    value.getUTCHours() !== 0 ||
    value.getUTCMinutes() !== 0
  ) {
    return undefined;
  }
  return { month, day };
}

export function scalarText(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return input.trim();
  if (typeof input === "number" || typeof input === "boolean") {
    return String(input).trim();
  }
  if (input instanceof Date && Number.isFinite(input.getTime())) {
    return input.toISOString();
  }
  if (
    typeof input === "object" &&
    "text" in input &&
    typeof input.text === "string"
  ) {
    return input.text.trim();
  }
  return "";
}
