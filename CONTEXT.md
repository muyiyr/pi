# Coding Agent Context

This context defines the language used for conversation summarization and reasoning effort in the coding agent.

## Language

**Compaction**:
Replacement of older session context with a summary while retaining recent context so the session can continue within the model's context limit.
_Avoid_: Branch summarization, truncation

**Branch summarization**:
Preservation of relevant context when navigating from one conversation branch to another.
_Avoid_: Compaction

**Session thinking level**:
The reasoning effort used for ordinary model turns in the current session.
_Avoid_: Compaction thinking level

**Compaction thinking level**:
The reasoning effort used only to generate compaction summaries. When unspecified, it inherits the current session thinking level within the compaction model's capabilities.
_Avoid_: Session thinking level, branch-summary thinking level

**Compaction model**:
The model used only to generate compaction summaries. When unspecified, it inherits the current session model.
_Avoid_: Session model, branch-summary model
