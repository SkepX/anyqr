import { readFileSync } from "node:fs";
import type { Script, SpendingValidator } from "@lucid-evolution/lucid";

/**
 * Blueprint JSON emitted by `aiken build`. Only the fields we consume are
 * typed — enough for locating the escrow validator.
 */
export interface Blueprint {
  validators: Array<{
    title: string;
    hash: string;
    compiledCode: string;
  }>;
}

/** Load a plutus.json blueprint from disk. */
export function loadBlueprint(path: string): Blueprint {
  return JSON.parse(readFileSync(path, "utf8")) as Blueprint;
}

/**
 * Build a Lucid SpendingValidator for the given handler title.
 * Example title: "escrow.escrow.spend".
 */
export function pickValidator(
  blueprint: Blueprint,
  title: string,
): SpendingValidator & Script {
  const v = blueprint.validators.find((x) => x.title === title);
  if (!v) throw new Error(`validator "${title}" not found in blueprint`);
  return {
    type: "PlutusV3",
    script: v.compiledCode,
  };
}
