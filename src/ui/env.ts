import type { StructuralModel } from '../core/model';
import type { Selection } from '../core/selection';

export interface EditorEnv {
  model(): StructuralModel;
  apply(label: string, fn: (m: StructuralModel) => void): void;
  select(sel: Selection): void;
}
