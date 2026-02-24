export class LLMFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMFormatError';
  }
}