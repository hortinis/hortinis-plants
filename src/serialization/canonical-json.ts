export type CanonicalJsonErrorCode =
  "INVALID_JSON" | "DUPLICATE_KEY" | "UNSUPPORTED_VALUE";

export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode;
  readonly instancePath: string;

  constructor(
    code: CanonicalJsonErrorCode,
    message: string,
    instancePath = "",
  ) {
    super(message);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.instancePath = instancePath;
  }
}

/** Serialize a JSON-domain value to deterministic UTF-8 bytes. */
export function serializeCanonicalJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(serialize(value, "", new Set()));
}

/** Parse JSON while rejecting duplicate object members. */
export function parseJsonStrict(source: string | Uint8Array): unknown {
  let text: string;
  try {
    text =
      typeof source === "string"
        ? source
        : new TextDecoder("utf-8", { fatal: true }).decode(source);
    JSON.parse(text);
  } catch {
    throw new CanonicalJsonError("INVALID_JSON", "Invalid UTF-8 or JSON", "");
  }
  new DuplicateKeyScanner(text).scan();
  return JSON.parse(text) as unknown;
}

function serialize(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      if ([...value].some((char) => char.codePointAt(0)! > 0x10ffff)) {
        throw unsupported(path, "Invalid Unicode string");
      }
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (
          code >= 0xd800 &&
          code <= 0xdbff &&
          (index + 1 >= value.length || !isLow(value.charCodeAt(index + 1)))
        ) {
          throw unsupported(path, "Lone Unicode surrogate");
        }
        if (
          code >= 0xdc00 &&
          code <= 0xdfff &&
          (index === 0 || !isHigh(value.charCodeAt(index - 1)))
        ) {
          throw unsupported(path, "Lone Unicode surrogate");
        }
      }
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw unsupported(path, "Non-finite number");
      return JSON.stringify(value);
    case "object":
      if (ancestors.has(value)) throw unsupported(path, "Cyclic reference");
      ancestors.add(value);
      try {
        if (Array.isArray(value)) return serializeArray(value, path, ancestors);
        return serializeObject(value, path, ancestors);
      } finally {
        ancestors.delete(value);
      }
    default:
      throw unsupported(path, `Unsupported ${typeof value}`);
  }
}

function serializeArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>,
): string {
  const names = Object.getOwnPropertyNames(value);
  const expected = new Set([
    "length",
    ...value.map((_, index) => String(index)),
  ]);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index))
      throw unsupported(`${path}/${index}`, "Sparse array");
  }
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    names.some((name) => !expected.has(name))
  ) {
    throw unsupported(path, "Array has unsupported properties");
  }
  return `[${value.map((entry, index) => serialize(entry, `${path}/${index}`, ancestors)).join(",")}]`;
}

function serializeObject(
  value: object,
  path: string,
  ancestors: Set<object>,
): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw unsupported(path, "Non-plain object");
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw unsupported(path, "Symbol-keyed property");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor))
      throw unsupported(joinPath(path, key), "Unsupported property");
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key], joinPath(path, key), ancestors)}`).join(",")}}`;
}

function joinPath(path: string, key: string): string {
  return `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function unsupported(path: string, reason: string): CanonicalJsonError {
  return new CanonicalJsonError("UNSUPPORTED_VALUE", reason, path);
}
function isHigh(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}
function isLow(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

class DuplicateKeyScanner {
  private index = 0;
  constructor(private readonly source: string) {}
  scan(): void {
    this.skipWhitespace();
    this.value("");
    this.skipWhitespace();
  }
  private value(path: string): void {
    const char = this.source[this.index];
    if (char === "{") return this.object(path);
    if (char === "[") return this.array(path);
    if (char === '"') {
      this.string();
      return;
    }
    while (
      this.index < this.source.length &&
      !",]}".includes(this.source[this.index]!)
    )
      this.index += 1;
  }
  private object(path: string): void {
    this.index += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return;
    }
    while (true) {
      this.skipWhitespace();
      const key = this.string();
      if (keys.has(key))
        throw new CanonicalJsonError(
          "DUPLICATE_KEY",
          `Duplicate object key ${key}`,
          joinPath(path, key),
        );
      keys.add(key);
      this.skipWhitespace();
      this.index += 1;
      this.skipWhitespace();
      this.value(joinPath(path, key));
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return;
      }
      this.index += 1;
    }
  }
  private array(path: string): void {
    this.index += 1;
    this.skipWhitespace();
    let item = 0;
    if (this.source[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (true) {
      this.value(`${path}/${item}`);
      item += 1;
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return;
      }
      this.index += 1;
      this.skipWhitespace();
    }
  }
  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === "\\") this.index += 1;
      else if (char === '"')
        return JSON.parse(this.source.slice(start, this.index)) as string;
    }
    return "";
  }
  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }
}
