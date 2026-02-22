import { Nucleus, NucleusInput, NucleusResult } from './nucleus.interface';

export abstract class BaseNucleus implements Nucleus {
  abstract analyze(input: NucleusInput): Promise<NucleusResult>;
}
