export default class ErrorUtil {
  static getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    } else if (typeof error === 'string') {
      return error;
    } else if (error && typeof error === 'object') {
      if ('message' in error && typeof error.message === 'string') {
        return error.message;
      }
      return JSON.stringify(error);
    } else {
      return 'An unknown error occurred';
    }
  }
}
