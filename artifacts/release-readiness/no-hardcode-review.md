# No-Hardcode Review (Current Iteration)

- Scope: `sidecar/src/**`, `desktop/src/**`
- Inputs:
  - `artifacts/release-readiness/no-hardcode-l1.raw.txt`
  - `artifacts/release-readiness/no-hardcode-l1.suspect.txt`
  - `artifacts/release-readiness/no-hardcode-l2-controlflow.raw.txt`
  - `artifacts/release-readiness/no-hardcode-l2.suspect.txt`

## Result

- `l1.raw`: 61
- `l1.suspect`: 34
- `l2.suspect`: 0
- Forbidden (runtime control-flow special cases by repo/provider/path literal): **0**

## Manual Triage Notes

- UI/i18n `marketplace` strings (desktop locale/components): content-only literals, not runtime control-flow routing by repo/provider/path.
- `sidecar/src/mastra/marketplaceGovernance.ts`: marketplace policy/audit reason constants; no repo/provider/path literal branching for special-case repos.
- `desktop/src/hooks/useSkillDiscovery.ts`: GitHub URL format checks are generic parser guards, not repo-specific routing.

Conclusion: current iteration does not introduce forbidden runtime literal special-casing.
