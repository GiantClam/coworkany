# Workflow Dynamic Selectors

## Goal

Make workflow node configuration consistent with the desktop workspaces: voice synthesis selects a voice from the currently selected audio Provider, and agent execution selects an Agent from the desktop Agent Center catalog.

## Design

The shared `WorkbenchWorkflowParameterFields` renderer gains optional host-supplied dynamic option lists for `voiceId` and `agentId`. These lists are rendered as native selects while all other schema fields keep their existing behavior. A selected value is retained as an option when it is not present in the current catalog so imported or older workflows remain readable; new selections always persist the stable provider voice ID or Agent ID.

The desktop workflow canvas resolves the selected node Provider and passes Provider-scoped voice options plus the Agent Center cards into the shared renderer. Voice discovery reuses the existing `media.voices` host request, keyed by the selected audio Provider, with loading and empty states represented in the select. Agent options are derived from the same `localAgentGroups` used by the Agent Center, preserving localized display names and stable IDs.

Changing `selectedProviderId` does not mutate configuration in the renderer. The desktop node update handler clears a voice ID when it is no longer valid for the newly selected Provider, preventing stale Provider-specific values while preserving arbitrary legacy values until a Provider change is made.

`agent_execute.operation = audio_transcription` remains supported. Its Provider/model binding behavior is unchanged; the Agent selector is only used for the normal Agent operation.

## Error and empty states

Voice loading failures keep the selector usable with the existing value and show a localized status hint. No available voices or Agents show a disabled placeholder rather than falling back to a free-form text field. Existing persisted string values remain selectable as compatibility options.

## Verification

Add shared renderer tests for dynamic voice/Agent selects, localized labels, loading/empty states, and legacy value retention. Add desktop helper tests for Provider-scoped voice mapping and Agent catalog mapping. Run affected package tests, TypeScript checks, and the desktop build/typecheck path.
