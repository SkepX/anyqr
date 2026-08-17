import { readFileSync } from "node:fs";
/** Load a plutus.json blueprint from disk. */
export function loadBlueprint(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}
/**
 * Build a Lucid SpendingValidator for the given handler title.
 * Example title: "escrow.escrow.spend".
 */
export function pickValidator(blueprint, title) {
    const v = blueprint.validators.find((x) => x.title === title);
    if (!v)
        throw new Error(`validator "${title}" not found in blueprint`);
    return {
        type: "PlutusV3",
        script: v.compiledCode,
    };
}
//# sourceMappingURL=blueprint.js.map