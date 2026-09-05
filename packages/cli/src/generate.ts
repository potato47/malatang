import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const FIA_API_SCHEMA_VERSION = 1 as const;

interface JSONSchema {
  readonly type?: "object" | "array" | "string" | "integer" | "number" | "boolean" | "null";
  readonly properties?: Readonly<Record<string, JSONSchema>>;
  readonly required?: readonly string[];
  readonly items?: JSONSchema;
  readonly enum?: readonly (string | number | boolean)[];
  readonly $ref?: string;
  readonly oneOf?: readonly JSONSchema[];
  readonly description?: string;
}

export interface NativeMethodSchema {
  readonly name: string;
  readonly input?: JSONSchema;
  readonly output?: JSONSchema;
  readonly errors?: readonly string[];
}

export interface NativeEventSchema {
  readonly name: string;
  readonly payload?: JSONSchema;
}

export interface NativeErrorSchema {
  readonly code: string;
  readonly description?: string;
  readonly recoverable: boolean;
}

export interface NativeAPISchema {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly schemaVersion: typeof FIA_API_SCHEMA_VERSION;
  readonly namespace: string;
  readonly $defs: Readonly<Record<string, JSONSchema>>;
  readonly methods: readonly NativeMethodSchema[];
  readonly errors: readonly NativeErrorSchema[];
  readonly events: readonly NativeEventSchema[];
}

export interface GenerateResult {
  readonly changed: readonly string[];
  readonly outputs: readonly string[];
}

export interface GenerateOptions {
  readonly cwd: string;
  readonly check?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertName(value: unknown, path: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(value) ||
    value.length > 128
  ) {
    throw new Error(`${path}: expected a safe identifier`);
  }
}

function assertSwiftTypeName(value: string, path: string): void {
  if (!/^[A-Z][A-Za-z0-9]{0,127}$/u.test(value)) {
    throw new Error(`${path}: expected an UpperCamelCase Swift type name`);
  }
}

function validateJSONSchema(
  value: unknown,
  path: string,
  definitions: Readonly<Record<string, unknown>>,
): asserts value is JSONSchema {
  if (!isObject(value)) throw new Error(`${path}: expected a JSON Schema object`);
  const allowed = new Set([
    "type",
    "properties",
    "required",
    "items",
    "enum",
    "$ref",
    "oneOf",
    "description",
  ]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new Error(`${path}.${unknown}: unsupported schema keyword`);
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error(`${path}.description: expected a string`);
  }
  const structural = [value.type, value.$ref, value.oneOf].filter((item) => item !== undefined);
  if (structural.length !== 1)
    throw new Error(`${path}: expected exactly one of type, $ref, or oneOf`);
  if (value.$ref !== undefined) {
    if (typeof value.$ref !== "string" || !value.$ref.startsWith("#/$defs/")) {
      throw new Error(`${path}.$ref: only local $defs references are supported`);
    }
    const name = value.$ref.slice("#/$defs/".length);
    if (!(name in definitions)) throw new Error(`${path}.$ref: unknown definition ${name}`);
    if (Object.keys(value).some((key) => key !== "$ref" && key !== "description")) {
      throw new Error(`${path}: $ref cannot be combined with structural keywords`);
    }
    return;
  }
  if (value.oneOf !== undefined) {
    if (!Array.isArray(value.oneOf) || value.oneOf.length === 0)
      throw new Error(`${path}.oneOf: expected a non-empty array`);
    value.oneOf.forEach((item, index) =>
      validateJSONSchema(item, `${path}.oneOf.${index}`, definitions),
    );
    if (Object.keys(value).some((key) => !["oneOf", "description"].includes(key))) {
      throw new Error(`${path}: oneOf cannot be combined with structural keywords`);
    }
    return;
  }
  const types = ["object", "array", "string", "integer", "number", "boolean", "null"];
  if (typeof value.type !== "string" || !types.includes(value.type))
    throw new Error(`${path}.type: unsupported JSON type`);
  if (value.enum !== undefined) {
    if (
      !Array.isArray(value.enum) ||
      value.enum.length === 0 ||
      value.enum.some((item) => !["string", "number", "boolean"].includes(typeof item))
    ) {
      throw new Error(`${path}.enum: expected a non-empty primitive array`);
    }
    if (new Set(value.enum.map((item) => JSON.stringify(item))).size !== value.enum.length) {
      throw new Error(`${path}.enum: values must be unique`);
    }
  }
  if (value.type === "object") {
    if (!isObject(value.properties)) throw new Error(`${path}.properties: expected an object`);
    const properties = value.properties;
    const mappedFields = new Set<string>();
    for (const [name, schema] of Object.entries(properties)) {
      if (name.length === 0)
        throw new Error(`${path}.properties: property names must not be empty`);
      const mapped = swiftIdentifier(name).replaceAll("`", "");
      if (mapped.length === 0 || mappedFields.has(mapped)) {
        throw new Error(`${path}.properties.${name}: property name collides after Swift mapping`);
      }
      mappedFields.add(mapped);
      validateJSONSchema(schema, `${path}.properties.${name}`, definitions);
    }
    if (value.required !== undefined) {
      if (
        !Array.isArray(value.required) ||
        value.required.some((name) => typeof name !== "string" || !(name in properties))
      ) {
        throw new Error(`${path}.required: expected unique property names`);
      }
      if (new Set(value.required).size !== value.required.length)
        throw new Error(`${path}.required: expected unique property names`);
    }
  } else if (value.type === "array") {
    validateJSONSchema(value.items, `${path}.items`, definitions);
  } else if (
    value.properties !== undefined ||
    value.required !== undefined ||
    value.items !== undefined
  ) {
    throw new Error(`${path}: object/array keywords do not match type ${value.type}`);
  }
}

function parseSchema(value: unknown): NativeAPISchema {
  if (!isObject(value)) throw new Error("native-api/api.fia.json: expected an object");
  const allowed = new Set([
    "$schema",
    "schemaVersion",
    "namespace",
    "$defs",
    "methods",
    "errors",
    "events",
  ]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new Error(`native-api/api.fia.json.${unknown}: unknown field`);
  if (value.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error("native-api/api.fia.json.$schema: expected JSON Schema Draft 2020-12");
  }
  if (value.schemaVersion !== FIA_API_SCHEMA_VERSION) {
    throw new Error(`native-api/api.fia.json.schemaVersion: expected ${FIA_API_SCHEMA_VERSION}`);
  }
  assertName(value.namespace, "native-api/api.fia.json.namespace");
  assertSwiftTypeName(value.namespace, "native-api/api.fia.json.namespace");
  if (!isObject(value.$defs)) throw new Error("native-api/api.fia.json.$defs: expected an object");
  const definitions = value.$defs;
  for (const [name, schema] of Object.entries(definitions)) {
    assertSwiftTypeName(name, `native-api/api.fia.json.$defs.${name}`);
    validateJSONSchema(schema, `native-api/api.fia.json.$defs.${name}`, definitions);
  }
  if (!Array.isArray(value.methods))
    throw new Error("native-api/api.fia.json.methods: expected an array");
  if (!Array.isArray(value.errors))
    throw new Error("native-api/api.fia.json.errors: expected an array");
  if (!Array.isArray(value.events))
    throw new Error("native-api/api.fia.json.events: expected an array");
  const errorCodes = new Set<string>();
  const errorCases = new Set<string>();
  const errors = value.errors.map((item, index) => {
    if (!isObject(item))
      throw new Error(`native-api/api.fia.json.errors.${index}: expected an object`);
    const unknownErrorKey = Object.keys(item).find(
      (key) => !["code", "description", "recoverable"].includes(key),
    );
    if (unknownErrorKey !== undefined)
      throw new Error(`native-api/api.fia.json.errors.${index}.${unknownErrorKey}: unknown field`);
    if (typeof item.code !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(item.code)) {
      throw new Error(
        `native-api/api.fia.json.errors.${index}.code: expected a lower_snake_case code`,
      );
    }
    if (errorCodes.has(item.code))
      throw new Error(`native-api/api.fia.json.errors.${index}.code: duplicate error`);
    const swiftCase = swiftIdentifier(item.code).replaceAll("`", "");
    if (errorCases.has(swiftCase)) {
      throw new Error(
        `native-api/api.fia.json.errors.${index}.code: error name collides after Swift mapping`,
      );
    }
    if (item.description !== undefined && typeof item.description !== "string") {
      throw new Error(`native-api/api.fia.json.errors.${index}.description: expected a string`);
    }
    if (item.recoverable !== undefined && typeof item.recoverable !== "boolean") {
      throw new Error(`native-api/api.fia.json.errors.${index}.recoverable: expected a boolean`);
    }
    errorCodes.add(item.code);
    errorCases.add(swiftCase);
    return {
      code: item.code,
      ...(item.description === undefined ? {} : { description: item.description }),
      recoverable: item.recoverable ?? false,
    };
  });
  const methodNames = new Set<string>();
  const methodFunctions = new Set<string>();
  const methods = value.methods.map((item, index) => {
    if (!isObject(item))
      throw new Error(`native-api/api.fia.json.methods.${index}: expected an object`);
    const unknownMethodKey = Object.keys(item).find(
      (key) => !["name", "input", "output", "errors"].includes(key),
    );
    if (unknownMethodKey !== undefined)
      throw new Error(
        `native-api/api.fia.json.methods.${index}.${unknownMethodKey}: unknown field`,
      );
    assertName(item.name, `native-api/api.fia.json.methods.${index}.name`);
    if (methodNames.has(item.name))
      throw new Error(`native-api/api.fia.json.methods.${index}.name: duplicate method`);
    const swiftFunction = swiftIdentifier(item.name).replaceAll("`", "");
    if (methodFunctions.has(swiftFunction)) {
      throw new Error(
        `native-api/api.fia.json.methods.${index}.name: method name collides after Swift mapping`,
      );
    }
    methodNames.add(item.name);
    methodFunctions.add(swiftFunction);
    if (item.input !== undefined)
      validateJSONSchema(item.input, `native-api/api.fia.json.methods.${index}.input`, definitions);
    if (item.output !== undefined)
      validateJSONSchema(
        item.output,
        `native-api/api.fia.json.methods.${index}.output`,
        definitions,
      );
    if (
      item.errors !== undefined &&
      (!Array.isArray(item.errors) ||
        item.errors.some((code) => typeof code !== "string" || !errorCodes.has(code)))
    ) {
      throw new Error(
        `native-api/api.fia.json.methods.${index}.errors: expected declared error codes`,
      );
    }
    return {
      name: item.name,
      ...(item.input === undefined ? {} : { input: item.input as JSONSchema }),
      ...(item.output === undefined ? {} : { output: item.output as JSONSchema }),
      ...(item.errors === undefined ? {} : { errors: item.errors as string[] }),
    };
  });
  const eventNames = new Set<string>();
  const events = value.events.map((item, index) => {
    if (!isObject(item))
      throw new Error(`native-api/api.fia.json.events.${index}: expected an object`);
    const unknownEventKey = Object.keys(item).find((key) => !["name", "payload"].includes(key));
    if (unknownEventKey !== undefined)
      throw new Error(`native-api/api.fia.json.events.${index}.${unknownEventKey}: unknown field`);
    assertName(item.name, `native-api/api.fia.json.events.${index}.name`);
    if (eventNames.has(item.name))
      throw new Error(`native-api/api.fia.json.events.${index}.name: duplicate event`);
    eventNames.add(item.name);
    if (item.payload !== undefined)
      validateJSONSchema(
        item.payload,
        `native-api/api.fia.json.events.${index}.payload`,
        definitions,
      );
    return {
      name: item.name,
      ...(item.payload === undefined ? {} : { payload: item.payload as JSONSchema }),
    };
  });
  return {
    $schema: value.$schema,
    schemaVersion: FIA_API_SCHEMA_VERSION,
    namespace: value.namespace,
    $defs: definitions as Record<string, JSONSchema>,
    methods,
    errors,
    events,
  };
}

function swiftIdentifier(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  const output = parts
    .map((part, index) =>
      index === 0 ? part[0]!.toLowerCase() + part.slice(1) : part[0]!.toUpperCase() + part.slice(1),
    )
    .join("");
  const identifier = /^\d/u.test(output) ? `_${output}` : output;
  const reserved = new Set([
    "Any",
    "Self",
    "actor",
    "any",
    "associatedtype",
    "as",
    "async",
    "await",
    "break",
    "class",
    "case",
    "catch",
    "consume",
    "consuming",
    "continue",
    "deinit",
    "default",
    "defer",
    "distributed",
    "do",
    "each",
    "else",
    "enum",
    "extension",
    "fallthrough",
    "false",
    "fileprivate",
    "for",
    "func",
    "guard",
    "if",
    "import",
    "in",
    "init",
    "inout",
    "internal",
    "is",
    "isolated",
    "let",
    "macro",
    "nil",
    "nonisolated",
    "open",
    "operator",
    "package",
    "precedencegroup",
    "private",
    "protocol",
    "public",
    "repeat",
    "return",
    "rethrows",
    "self",
    "sending",
    "some",
    "static",
    "struct",
    "subscript",
    "super",
    "switch",
    "throw",
    "throws",
    "true",
    "try",
    "typealias",
    "var",
    "where",
    "while",
  ]);
  return reserved.has(identifier) ? `\`${identifier}\`` : identifier;
}

function typeNameFromRef(reference: string): string {
  const prefix = "#/$defs/";
  if (!reference.startsWith(prefix)) throw new Error(`unsupported schema reference: ${reference}`);
  return reference.slice(prefix.length);
}

function swiftType(schema: JSONSchema | undefined): string {
  if (schema === undefined) return "FIAEmpty";
  if (schema.$ref !== undefined) return typeNameFromRef(schema.$ref);
  if (schema.enum !== undefined && schema.enum.every((item) => typeof item === "string"))
    return "String";
  if (schema.oneOf !== undefined) {
    const nonNull = schema.oneOf.filter((item) => item.type !== "null");
    if (nonNull.length === 1 && nonNull.length !== schema.oneOf.length)
      return `${swiftType(nonNull[0])}?`;
  }
  switch (schema.type) {
    case "string":
      return "String";
    case "integer":
      return "Int";
    case "number":
      return "Double";
    case "boolean":
      return "Bool";
    case "array":
      return `[${swiftType(schema.items)}]`;
    case "object":
      return "FIAJSONValue";
    case "null":
      return "FIAEmpty";
    default:
      return "FIAJSONValue";
  }
}

function tsType(schema: JSONSchema | undefined): string {
  if (schema === undefined) return "void";
  if (schema.$ref !== undefined) return typeNameFromRef(schema.$ref);
  if (schema.enum !== undefined) return schema.enum.map((item) => JSON.stringify(item)).join(" | ");
  if (schema.oneOf !== undefined) return schema.oneOf.map(tsType).join(" | ");
  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `readonly ${tsType(schema.items)}[]`;
    case "object": {
      const required = new Set(schema.required ?? []);
      const fields = Object.entries(schema.properties ?? {}).map(
        ([name, field]) =>
          `  readonly ${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${tsType(field)};`,
      );
      return fields.length === 0 ? "Record<string, unknown>" : `{\n${fields.join("\n")}\n}`;
    }
    case "null":
      return "null";
    default:
      return "unknown";
  }
}

function swiftDefinition(name: string, schema: JSONSchema): string {
  if (schema.type !== "object" || schema.properties === undefined) {
    return `public typealias ${name} = ${swiftType(schema)}`;
  }
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties).map(([field, value]) => {
    const type = swiftType(value);
    return `    public let ${swiftIdentifier(field)}: ${required.has(field) || type.endsWith("?") ? type : `${type}?`}`;
  });
  const parameters = Object.entries(schema.properties).map(([field, value]) => {
    const identifier = swiftIdentifier(field);
    const type = swiftType(value);
    if (required.has(field)) return `${identifier}: ${type}`;
    return `${identifier}: ${type.endsWith("?") ? type : `${type}?`} = nil`;
  });
  const assignments = Object.keys(schema.properties).map((field) => {
    const identifier = swiftIdentifier(field);
    return `        self.${identifier} = ${identifier}`;
  });
  const needsCodingKeys = Object.keys(schema.properties).some(
    (field) => swiftIdentifier(field).replaceAll("`", "") !== field,
  );
  const codingKeys = Object.keys(schema.properties).map((field) => {
    const identifier = swiftIdentifier(field);
    return `        case ${identifier}${identifier.replaceAll("`", "") === field ? "" : ` = ${JSON.stringify(field)}`}`;
  });
  return [
    `public struct ${name}: Codable, Sendable {`,
    ...fields,
    "",
    `    public init(${parameters.join(", ")}) {`,
    ...assignments,
    "    }",
    ...(needsCodingKeys
      ? ["", "    private enum CodingKeys: String, CodingKey {", ...codingKeys, "    }"]
      : []),
    "}",
  ].join("\n");
}

function renderSwift(schema: NativeAPISchema): string {
  const definitions = Object.entries(schema.$defs).map(([name, value]) =>
    swiftDefinition(name, value),
  );
  const requirements = schema.methods.map((method) => {
    const functionName = swiftIdentifier(method.name);
    return `    func ${functionName}(_ input: ${swiftType(method.input)}) async throws -> ${swiftType(method.output)}`;
  });
  const registrations = schema.methods.map((method) => {
    const functionName = swiftIdentifier(method.name);
    return `        registry.register(${JSON.stringify(method.name)}, input: ${swiftType(method.input)}.self, output: ${swiftType(method.output)}.self) { input in\n            try await self.${functionName}(input)\n        }`;
  });
  const errorCases = schema.errors.map(
    (error) => `    case ${swiftIdentifier(error.code)} = ${JSON.stringify(error.code)}`,
  );
  const errorDefinition =
    errorCases.length === 0
      ? `public typealias ${schema.namespace}ErrorCode = String`
      : `public enum ${schema.namespace}ErrorCode: String, Codable, Sendable {\n${errorCases.join("\n")}\n}`;
  return `// Generated by FIA 2.0. Do not edit.\nimport FIA\nimport Foundation\n\n${definitions.join("\n\n")}\n\n${errorDefinition}\n\npublic protocol ${schema.namespace}Protocol: NativeMethodProvider {\n${requirements.join("\n")}\n}\n\npublic extension ${schema.namespace}Protocol {\n    @MainActor\n    func registerMethods(in registry: NativeMethodRegistry) {\n${registrations.join("\n")}\n    }\n}\n`;
}

function renderTypeScript(schema: NativeAPISchema): string {
  const definitions = Object.entries(schema.$defs).map(
    ([name, value]) => `export type ${name} = ${tsType(value)};`,
  );
  const methods = schema.methods.map((method) => {
    const name = swiftIdentifier(method.name);
    const input = tsType(method.input);
    const output = tsType(method.output);
    const argument =
      method.input === undefined
        ? "options?: NativeCallOptions"
        : `input: ${input}, options?: NativeCallOptions`;
    const callArgument = method.input === undefined ? "undefined" : "input";
    return `    ${name}(${argument}): Promise<${output}> {\n      return transport.call<${output}>(${JSON.stringify(method.name)}, ${callArgument}, options);\n    },`;
  });
  const errors =
    schema.errors.length === 0
      ? "never"
      : schema.errors.map((error) => JSON.stringify(error.code)).join(" | ");
  const events = schema.events
    .map((event) => `  readonly ${JSON.stringify(event.name)}: ${tsType(event.payload)};`)
    .join("\n");
  return `// Generated by FIA 2.0. Do not edit.\nimport { native, type NativeCallOptions, type NativeTransport } from "@semicoder/fia/client";\n\n${definitions.join("\n\n")}\n\nexport type ${schema.namespace}ErrorCode = ${errors};\n\nexport type ${schema.namespace}Events = {\n${events}\n};\n\nexport function create${schema.namespace}(transport: NativeTransport) {\n  return {\n${methods.join("\n")}\n    on<Name extends keyof ${schema.namespace}Events>(\n      name: Name,\n      listener: (payload: ${schema.namespace}Events[Name]) => void,\n    ): () => void {\n      return transport.on(name, (payload) => listener(payload as ${schema.namespace}Events[Name]));\n    },\n  } as const;\n}\n\nexport const appNative = create${schema.namespace}(native);\n\nexport function on${schema.namespace}Event<Name extends keyof ${schema.namespace}Events>(\n  name: Name,\n  listener: (payload: ${schema.namespace}Events[Name]) => void,\n): () => void {\n  return appNative.on(name, listener);\n}\n`;
}

async function current(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function generateNativeAPI(options: GenerateOptions): Promise<GenerateResult> {
  const root = resolve(options.cwd);
  const schemaPath = resolve(root, "native-api/api.fia.json");
  const schema = parseSchema(JSON.parse(await readFile(schemaPath, "utf8")) as unknown);
  const outputs = new Map<string, string>([
    [
      resolve(root, "native/Sources/FIAApp/Generated/NativeAPI.generated.swift"),
      renderSwift(schema),
    ],
    [resolve(root, "generated/native-api.ts"), renderTypeScript(schema)],
  ]);
  const changed: string[] = [];
  for (const [path, contents] of outputs) {
    if ((await current(path)) === contents) continue;
    changed.push(relative(root, path));
    if (options.check !== true) {
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, contents, "utf8");
    }
  }
  return { changed, outputs: [...outputs.keys()].map((path) => relative(root, path)) };
}

export async function readNativeAPISchema(cwd: string): Promise<NativeAPISchema> {
  return parseSchema(
    JSON.parse(await readFile(resolve(cwd, "native-api/api.fia.json"), "utf8")) as unknown,
  );
}
