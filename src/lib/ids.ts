/** Human-readable identifiers used in the UI and in exports. */
export const workspaceRef = (seq: number) => `WS-${String(seq).padStart(3, "0")}`;
export const userRef = (seq: number) => `USR-${String(seq).padStart(3, "0")}`;
export const txnRef = (n: number) => `TXN-${String(n).padStart(4, "0")}`;
export const journalRef = (n: number) => `JE-${String(n).padStart(4, "0")}`;
