import { createRequire } from "node:module";
import { resolve } from "node:path";

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: ValidationError[] };

export interface ValidationError {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
}

export type ValidationPipelineErrorCode =
  | "UNKNOWN_SCHEMA_ID"
  | "INVALID_SCHEMA_REGISTRY"
  | "VALIDATOR_EXECUTION_FAILED";

export class ValidationPipelineError extends Error {
  readonly code: ValidationPipelineErrorCode;

  constructor(
    code: ValidationPipelineErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ValidationPipelineError";
    this.code = code;
  }
}

interface CompiledValidator {
  (value: unknown): unknown;
  errors?: unknown;
}

export type ValidatorRegistry = Readonly<Record<string, CompiledValidator>>;

interface RegistryModule {
  readonly validatorsBySchemaId?: unknown;
}

let loadedApi: ValidationApi | undefined;

/** @internal Used to test the boundary independently of generated files. */
export function createValidationApi(registry: unknown): ValidationApi {
  const validatorsBySchemaId = validateRegistry(registry);

  return {
    validate(schemaId, value) {
      if (!Object.hasOwn(validatorsBySchemaId, schemaId)) {
        throw new ValidationPipelineError(
          "UNKNOWN_SCHEMA_ID",
          `Unknown schema identifier ${schemaId}`,
        );
      }
      const validator = validatorsBySchemaId[schemaId];
      if (validator === undefined) {
        throw invalidRegistry(
          `Validator for schema ${schemaId} is unexpectedly undefined`,
        );
      }

      let valid: unknown;
      try {
        valid = validator(value);
      } catch (error) {
        throw new ValidationPipelineError(
          "VALIDATOR_EXECUTION_FAILED",
          `Validator failed for schema ${schemaId}`,
          { cause: error },
        );
      }

      if (valid === true) {
        return { valid: true };
      }
      if (valid !== false) {
        throw invalidRegistry(
          `Validator for schema ${schemaId} returned a non-boolean result`,
        );
      }

      const errors = normalizeErrors(validator.errors, schemaId);
      return { valid: false, errors };
    },
  };
}

export interface ValidationApi {
  validate(schemaId: string, value: unknown): ValidationResult;
}

/** Validate data against a schema compiled into the repository registry. */
export function validate(schemaId: string, value: unknown): ValidationResult {
  loadedApi ??= createValidationApi(loadGeneratedRegistry());
  return loadedApi.validate(schemaId, value);
}

function loadGeneratedRegistry(): unknown {
  const require = createRequire(import.meta.url);
  const registryPath = resolve(
    import.meta.dirname,
    "../../dist/generated/schema-registry.cjs",
  );

  let moduleValue: unknown;
  try {
    moduleValue = require(registryPath) as unknown;
  } catch (error) {
    throw new ValidationPipelineError(
      "INVALID_SCHEMA_REGISTRY",
      `Unable to load generated schema registry at ${registryPath}`,
      { cause: error },
    );
  }

  if (
    moduleValue === null ||
    typeof moduleValue !== "object" ||
    Array.isArray(moduleValue)
  ) {
    throw invalidRegistry("Generated schema registry module must be an object");
  }

  return (moduleValue as RegistryModule).validatorsBySchemaId;
}

function validateRegistry(registry: unknown): ValidatorRegistry {
  if (
    registry === null ||
    typeof registry !== "object" ||
    Array.isArray(registry)
  ) {
    throw invalidRegistry("Schema registry must be an object");
  }

  const entries = Object.entries(registry);
  if (entries.length === 0) {
    throw invalidRegistry(
      "Schema registry must contain at least one validator",
    );
  }

  for (const [schemaId, validator] of entries) {
    if (typeof validator !== "function") {
      throw invalidRegistry(
        `Validator for schema ${schemaId} must be a function`,
      );
    }
  }

  return registry as ValidatorRegistry;
}

function normalizeErrors(value: unknown, schemaId: string): ValidationError[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidRegistry(
      `Validator for schema ${schemaId} returned false without errors`,
    );
  }

  const errors = value.map((error, index) => {
    if (
      error === null ||
      typeof error !== "object" ||
      typeof (error as { instancePath?: unknown }).instancePath !== "string" ||
      typeof (error as { schemaPath?: unknown }).schemaPath !== "string" ||
      typeof (error as { keyword?: unknown }).keyword !== "string" ||
      typeof (error as { message?: unknown }).message !== "string"
    ) {
      throw invalidRegistry(
        `Validator for schema ${schemaId} returned malformed error at index ${index}`,
      );
    }

    const candidate = error as ValidationError;
    return {
      error: {
        instancePath: candidate.instancePath,
        schemaPath: candidate.schemaPath,
        keyword: candidate.keyword,
        message: candidate.message,
      },
      index,
    };
  });

  errors.sort((left, right) => {
    const fields: (keyof ValidationError)[] = [
      "instancePath",
      "schemaPath",
      "keyword",
      "message",
    ];
    for (const field of fields) {
      const comparison = compareStrings(left.error[field], right.error[field]);
      if (comparison !== 0) return comparison;
    }
    return left.index - right.index;
  });

  return errors.map(({ error }) => error);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidRegistry(message: string): ValidationPipelineError {
  return new ValidationPipelineError("INVALID_SCHEMA_REGISTRY", message);
}
