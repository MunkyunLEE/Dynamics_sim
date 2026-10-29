# Dynamics_sim

브라우저에서 동작하는 3D 구조 진동 시뮬레이터 (GitHub Pages 배포).

## 단위계

mm, N, tonne, s 고정. 응력 MPa, 밀도 tonne/mm³, 가속도 mm/s², 중력 9810 mm/s².

## 실행

```
npm install
npm run dev
npm run build
```

## 구성

- `src/core` 모델 타입, 단위, 샘플
- `src/io` JSON 입력 및 검증
- `src/viewer` Three.js 뷰어 (Z-up)
- `src/ui` 사이드바 패널
- `rhino/export_model.py` Grasshopper Python 내보내기 (곡선 → 바, 메쉬 → 쉘 패널)

설계 결정과 로드맵은 `docs/DESIGN.md` 참고.
