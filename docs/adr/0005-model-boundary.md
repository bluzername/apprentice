# ADR 0005: Model boundary and UI-Mate as an action policy

Status: accepted (2026-09-02)

## Decision

- `VisionAgentProvider` is the only model interface. Implementations: mock (deterministic),
  OpenAI-compatible generic multimodal, and an exact UI-Mate port pinned to upstream commit
  `1cb9e1e`.
- UI-Mate is used only for `proposeNextAction`, in the official demonstration-guided mode
  (workflow section, `subtask_complete`, `finished`). Episode analysis, skill drafting, and
  supporting verification go to a generic provider; when none is configured they fail over to the
  deterministic engine explicitly.
- Model output is parsed into the strict `ProposedAction` union, then validated, risk-classified,
  and policy-gated outside the model. Hidden reasoning (`<think>`) is discarded at parse time and
  never persisted.
- Coordinates flow: model 0-999 -> resized image pixels (UI-Mate `smart_resize`) -> display points
  through the stored `ImageTransform`.

## Consequences

The product works fully without a model (demo mode uses the mock). Replacing UI-Mate means adding
one provider file.
