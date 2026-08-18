export type ConfigureEvolutionStepResult = {
  ok: boolean;
  error?: string;
  data?: unknown;
};

export type ConfigureEvolutionResult = {
  webhookUrl: string | null;
  connect: ConfigureEvolutionStepResult;
  verify: ConfigureEvolutionStepResult;
};
