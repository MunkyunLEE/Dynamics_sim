import { solveModal } from '../solvers/eigen';
import type { ModalOptions } from '../solvers/eigen';
import type { StructuralModel } from '../core/model';

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<{ model: StructuralModel; options: ModalOptions }>) => {
  try {
    const result = solveModal(e.data.model, e.data.options);
    ctx.postMessage({ ok: true, result });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
