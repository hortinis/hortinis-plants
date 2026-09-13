export type ImportOutputRole =
  "assertions" | "evidence" | "diagnostics" | "auxiliary";

export interface ImportInputResource {
  /** Locator recorded in the source manifest, or a stable derived-input locator. */
  readonly locator: string;
  /** Local path relative to the supplied resource directory. */
  readonly path: string;
  readonly role: "upstream" | "derived";
  /** Required for derived resources, whose digest is not in the source manifest. */
  readonly sha256?: string;
  readonly derivedFrom?: string;
  readonly preparation?: {
    readonly tool: string;
    readonly version: string;
    readonly command: string;
  };
}

export interface ImportOutputDefinition {
  readonly name: string;
  readonly path: string;
  readonly role: ImportOutputRole;
  readonly mediaType: string;
  readonly schemaId?: string;
}

export interface ImporterDefinition<TConfiguration = unknown> {
  readonly name: string;
  readonly version: string;
  readonly configuration: TConfiguration;
  readonly inputs: readonly ImportInputResource[];
  readonly outputs: readonly ImportOutputDefinition[];
  readonly tools: Readonly<Record<string, string>>;
  readonly run: (
    context: ImportContext<TConfiguration>,
  ) => AsyncIterable<ImportEvent>;
}

export interface ImportContext<TConfiguration = unknown> {
  readonly configuration: TConfiguration;
  readonly sourceManifest: unknown;
  readonly sourceManifestId: string;
  /** Resolve an input by its declared locator to its verified local file path. */
  resourcePath(locator: string): string;
}

export interface ImportEvent {
  readonly output: string;
  readonly value: unknown;
}

export interface ImportOutputResult {
  readonly path: string;
  readonly role: ImportOutputRole;
  readonly mediaType: string;
  readonly schemaId?: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly recordCount: number;
}

export interface ImporterRunResult {
  readonly manifest: unknown;
  readonly manifestSha256: string;
  readonly outputDirectory: string;
}

export interface ImporterRunOptions<TConfiguration = unknown> {
  readonly importer: ImporterDefinition<TConfiguration>;
  readonly sourceManifestPath: string;
  readonly resourceDirectory: string;
  readonly outputDirectory: string;
  readonly validationApi?: import("../schema/validation-api.js").ValidationApi;
}
