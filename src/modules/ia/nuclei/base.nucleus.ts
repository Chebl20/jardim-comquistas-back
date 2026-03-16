import { Nucleus, NucleusInput } from './nucleus.interface';
import { FlowResult } from '../conversation/flow.types';

export abstract class BaseNucleus implements Nucleus {
  abstract analyze(input: NucleusInput): Promise<FlowResult | any>;
}
