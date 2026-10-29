import { solveModal } from '../solvers/eigen';
import type { ModalOptions } from '../solvers/eigen';
import { solveTimeHistory } from '../solvers/timeHistory';
import type { MotionInput, TimeHistoryOptions } from '../solvers/timeHistory';
import type { StructuralModel } from '../core/model';

const ctx = self as unknown as Worker;

type Request =
  | { kind: 'modal'; model: StructuralModel; options: ModalOptions }
  | { kind: 'th'; model: StructuralModel; motion: MotionInput; options: TimeHistoryOptions };

ctx.onmessage = (e: MessageEvent<Request>) => {
  try {
    const req = e.data;
    if (req.kind === 'th') ctx.postMessage({ ok: true, result: solveTimeHistory(req.model, req.motion, req.options) });
    else ctx.postMessage({ ok: true, result: solveModal(req.model, req.options) });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
