export class NotAuthenticatedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

export class AppViewNotSupportedError extends Error {
  constructor(message = 'Active AppView does not support this operation') {
    super(message);
    this.name = 'AppViewNotSupportedError';
  }
}
