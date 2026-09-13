export type ImporterRunErrorCode =
  | "INVALID_SOURCE_MANIFEST"
  | "SOURCE_RESOURCE_MISMATCH"
  | "INVALID_IMPORTER_CONFIGURATION"
  | "INVALID_IMPORTER_DEFINITION"
  | "INVALID_IMPORT_EVENT"
  | "OUTPUT_VALIDATION_FAILED"
  | "IMPORTER_FAILED"
  | "IMPORTER_OUTPUT_FAILED";

export class ImporterRunError extends Error {
  readonly code: ImporterRunErrorCode;

  constructor(
    code: ImporterRunErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImporterRunError";
    this.code = code;
  }
}
