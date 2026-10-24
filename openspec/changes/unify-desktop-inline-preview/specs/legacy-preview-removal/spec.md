# Specification: Desktop Preview Legacy Removal

## REMOVED Requirements

### Requirement: Automatic browser preview

The desktop preview path SHALL no longer automatically call `window.open`, system-browser launch APIs, or equivalent actions when a local web/PPT preview becomes ready.

### Requirement: Dify preview integration

The desktop preview architecture SHALL not depend on Dify routes, Dify SSE events or Dify-specific message parsing.

## ADDED Requirements

### Requirement: Explicit external-open fallback

If inline preview is unavailable and a safe local artifact can be opened externally, the action SHALL be visible and user initiated; failure of that action SHALL not be reported as preview success.

#### Scenario: Inline preview cannot be resolved

- **GIVEN** a preview source is unavailable or rejected by host validation
- **WHEN** the current conversation renders the preview
- **THEN** the conversation SHALL show an unavailable state and any supported explicit fallback action
- **AND** it SHALL not open a browser automatically

#### Scenario: Explicit fallback fails

- **GIVEN** the user explicitly selects the external-open fallback
- **WHEN** the host cannot open the resolved local artifact
- **THEN** the UI SHALL report the fallback failure as an error
- **AND** it SHALL not mark the inline preview as successfully opened
