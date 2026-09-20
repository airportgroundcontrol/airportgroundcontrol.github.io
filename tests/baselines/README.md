# Architecture Baseline

Captured before changes to product source, from `e681385e78f18ebcae483448e6660b5e2f916da6` on 2026-09-20. All data is synthetic test traffic, never a personal browser save.

- `../fixtures/v1/`: 23 frozen version-1 envelopes plus SHA-256 digests of their bytes and simulation state after 100 ticks of 0.1 seconds. Normal tests never regenerate these expectations. Includes every lifecycle state, runway vacating, mid-edge/manual/clearance-limit holds, route draft, follow and give-way issued/waiting states.
- `desktop.png`, `mobile.png`: representative visual references from the existing browser suite. Dynamic clocks/pulses mean these are human-review references, not pixel-perfect assertions. Browser tests additionally assert dimensions and nonblank Canvas pixels at five sizes.
- `performance.json`: same-machine diagnostic timing with 24 aircraft at distinct Edinburgh stands and separate 60/120-aircraft synthetic overlapping stress cases. Higher counts are not a supported gameplay-capacity change. The save loader deliberately caps accepted saves at 100 aircraft, so the 120-aircraft result measures writes only.

At 24 aircraft on Apple M2 Pro / headless Chrome 138, p95 simulation tick was 0.20 ms, synchronous Canvas draw submission 3.10 ms, and save 0.10 ms (12,690 bytes). Measurements below timer resolution may report zero; this is not zero cost. These are not full-frame/GPU timings or mobile-device benchmarks, and are not CI thresholds.

Run `npm run verify` for build, unit/fixture tests and all browser suites. Run `npm run benchmark` to write a new report under `test-results/`; compare with this baseline, do not overwrite it casually. Browser tests default to installed Google Chrome; `BROWSER_CHANNEL` can select another installed Playwright channel. `ARTIFACT_DIR` changes the report/screenshot directory and `BASE_URL` can target an already running preview. Without `BASE_URL`, the runner owns a temporary loopback server on an OS-selected port.

Intentional MVP simplifications remain documented in README: one active runway, fixed 60-metre spacing, simple right-of-way yielding, controller-managed head-on conflicts, simplified physics/turnaround and no automatic stop at uninstructed mapped holding points. Refactoring must not silently reinterpret these rules.
