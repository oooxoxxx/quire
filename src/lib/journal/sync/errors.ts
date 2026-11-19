export type SyncErrorCode =
  | "PASSPHRASE_REQUIRED"
  | "BAD_PASSPHRASE"
  | "AUTH"
  | "OFFLINE"
  | "CORRUPT"
  | "GOOGLE"
  | "NETWORK";

export class SyncError extends Error {
  code: SyncErrorCode;

  constructor(code: SyncErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SyncError";
    this.code = code;
  }
}
