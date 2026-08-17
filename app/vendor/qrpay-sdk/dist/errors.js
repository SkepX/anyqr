export class SdkError extends Error {
    code;
    cause;
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = "SdkError";
    }
}
export const err = (code, message, cause) => new SdkError(code, message, cause);
//# sourceMappingURL=errors.js.map