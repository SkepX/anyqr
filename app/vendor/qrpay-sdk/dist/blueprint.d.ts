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
export declare function loadBlueprint(path: string): Blueprint;
/**
 * Build a Lucid SpendingValidator for the given handler title.
 * Example title: "escrow.escrow.spend".
 */
export declare function pickValidator(blueprint: Blueprint, title: string): SpendingValidator & Script;
//# sourceMappingURL=blueprint.d.ts.map