import type { JsonSchema } from "../core/types.ts";

// Small JSON Schema validator covering the subset used by tool definitions:
// type, properties, required, items, enum, minimum, maximum, additionalProperties.
// Tool inputs are untrusted model output, so every call is validated before it runs.
export function validate(schema: JsonSchema, value: unknown, path = "input"): string[] {
  const errors: string[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some((t) => matchesType(t, value))) {
    errors.push(`${path}: expected ${types.join("|")}, got ${describe(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(schema.items!, v, `${path}[${i}]`)));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (obj[r] === undefined) errors.push(`${path}.${r}: required`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) errors.push(...validate(sub, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: unknown property`);
    }
  }
  return errors;
}

function matchesType(t: string, v: unknown): boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    case "null":
      return v === null;
    default:
      return true;
  }
}

const describe = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
