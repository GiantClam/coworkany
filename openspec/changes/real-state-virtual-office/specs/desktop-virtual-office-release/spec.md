## Purpose

Define the evidence required to ship the virtual office without regressing Coworkany's existing workbench, task execution, or macOS desktop release behavior. The release gate covers automated behavior, performance, resource budgets, and evidence for the current macOS target.

## ADDED Requirements

### Requirement: Automated quality gates SHALL cover the complete office contract

The change SHALL pass focused office tests, existing desktop/workbench regression tests, typechecks, asset verification, and a production Vite build. The test suite SHALL cover source lifecycle, role classification, status recovery, navigation, React fallback, asset registry, renderer frame policy, and performance projection.

#### Scenario: A phase is incomplete
- **WHEN** a required focused test, typecheck, asset check, or build fails
- **THEN** the OpenSpec task remains open
- **AND** later phase completion MUST NOT be declared

#### Scenario: Post-cleaner verification runs
- **WHEN** the final cleanup pass changes source files
- **THEN** the complete applicable verification suite runs again
- **AND** the evidence records the post-cleaner result

### Requirement: Performance and resource budgets SHALL be measured

The office SHALL project fifty work items within the defined p95 budget, keep foreground rendering at the target frame budget, stop hidden tickers, lower idle frame rate, and keep the virtual-office asset gzip increment within 2.5 MiB. Bundle checks SHALL prove Pixi is absent from the static entry import closure and present only in the dynamic scene chunk.

#### Scenario: The static entry imports Pixi
- **WHEN** the bundle verifier inspects the Vite manifest
- **THEN** it fails the release gate
- **AND** the office is not marked default-enabled

#### Scenario: The asset budget is exceeded
- **WHEN** compressed office assets exceed 2.5 MiB
- **THEN** the release gate fails with the measured total
- **AND** the change remains open until the budget is met or an explicit reviewed exception is recorded

### Requirement: macOS acceptance evidence SHALL be retained

Completion SHALL include a macOS manual matrix covering empty office, concurrent work, workflow navigation, user waiting, completion/restart, failure, source failure/recovery, and renderer fallback. Windows validation is deferred to a follow-up change and is not required for this release. Missing or ambiguous macOS evidence SHALL keep the change open, and this change MUST NOT claim Windows compatibility.

#### Scenario: macOS fallback is exercised
- **WHEN** the manifest or renderer is intentionally made invalid in a development fixture
- **THEN** the complete React office and existing workbench controls remain usable
- **AND** the evidence records the fixture, result, and screenshot/log path

#### Scenario: Windows validation is deferred
- **WHEN** release evidence is reviewed for this change
- **THEN** Windows CI/build/smoke evidence is recorded as deferred follow-up work
- **AND** the release record states that only macOS has been verified

### Requirement: Final closure SHALL require architecture and independent review

The change SHALL not be archived until cleanup, post-cleaner verification, an architecture-invariant audit, and independent code-review and architect-review evidence all approve the result.

#### Scenario: Review finds an invariant violation
- **WHEN** review reports that office code creates a second task store or renderer imports business logic
- **THEN** closure is blocked
- **AND** a remediation task is added before re-review
