export class RelayError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function invalid() { throw new RelayError(400, 'invalid_request'); }
