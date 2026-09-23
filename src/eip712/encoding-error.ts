/**
 * An error thrown while encoding typed data. Carries the path of the value
 * that caused the failure, in the `primaryType.field[2].child` format, so
 * that callers can locate the offending field without the error message
 * having to echo the message values themselves.
 */
export class TypedDataEncodingError extends Error {
  /**
   * The path of the value that caused the error, e.g.
   * `Mail.to[1].wallet`.
   */
  public readonly path: string;

  /**
   * Create a new typed data encoding error.
   *
   * @param message - The error message, without path information.
   * @param path - The path of the value that caused the error.
   */
  constructor(message: string, path: string) {
    super(`${message} (at path: ${path})`);
    this.name = 'TypedDataEncodingError';
    this.path = path;
  }
}
