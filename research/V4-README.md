# Personal V4 model research

This directory contains research-only tooling. It does not change the deployed V15 app.

## First benchmark

Run from the repository root:

```bash
python scripts/v4_walkforward.py --input history.json --output research/v4-baseline-report.json
```

The benchmark sorts records by issue number and uses only earlier draws for each prediction. It evaluates fixed 30/60/120/300-draw frequency-weighted baselines and compares them with a uniform random Monte Carlo benchmark on the same test draws.

**Important data limitation:** 2,926 legacy records currently lack a date and source label. Issue order is therefore used as a provisional chronology, not as verified draw-date metadata. Do not infer dates or claim official provenance. This benchmark is exploratory and cannot establish future predictive advantage.
