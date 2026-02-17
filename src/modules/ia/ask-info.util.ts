export function createAskInfo(missing: string, options?: string[], prompt?: string) {
  const data: any = { missing };
  if (options && Array.isArray(options)) data.options = options;
  if (prompt && typeof prompt === 'string') data.prompt = prompt;
  return { intent: 'ASK_INFO', data };
}

export default createAskInfo;
