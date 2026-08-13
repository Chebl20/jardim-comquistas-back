export type ConfigureWuzApiStepResult = {
  ok: boolean;
  error?: string;
  data?: unknown;
};

export type ConfigureWuzApiResult = {
  webhookUrl: string | null;
  webhook: ConfigureWuzApiStepResult;
  verify: ConfigureWuzApiStepResult;
  hmac: ConfigureWuzApiStepResult;
  connect: ConfigureWuzApiStepResult;
};
