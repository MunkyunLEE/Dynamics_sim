import { solveModal } from '../solvers/eigen';
import type { ModalOptions } from '../solvers/eigen';
import { solveTimeHistory } from '../solvers/timeHistory';
import type { MotionInput, TimeHistoryOptions } from '../solvers/timeHistory';
import { analyzeMobility, solveKinematics } from '../solvers/kinematics';
import type { KinematicsOptions } from '../solvers/kinematics';
import type { StructuralModel } from '../core/model';

const ctx = self as unknown as Worker;

type Request =
  | { kind: 'modal'; model: StructuralModel; options: ModalOptions }
  | { kind: 'th'; model: StructuralModel; motion: MotionInput; options: TimeHistoryOptions }
  | { kind: 'kin'; model: StructuralModel; options: KinematicsOptions }
  | { kind: 'mob'; model: StructuralModel; ground: string | null };

ctx.onmessage = (e: MessageEvent<Request>) => {
  try {
    const req = e.data;
    let result: unknown;
    if (req.kind === 'th') result = solveTimeHistory(req.model, req.motion, req.options);
    else if (req.kind === 'kin') result = solveKinematics(req.model, req.options);
    else if (req.kind === 'mob') result = analyzeMobility(req.model, req.ground);
    else result = solveModal(req.model, req.options);
    ctx.postMessage({ ok: true, result });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
