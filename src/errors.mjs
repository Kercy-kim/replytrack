export class AppError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function assert(condition, message, status = 400) {
  if (!condition) throw new AppError(status, message);
}
