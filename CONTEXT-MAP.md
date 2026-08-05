# Context Map

## Contexts

- [Pi TUI](./CONTEXT.md) - defines terminal interaction language
- [AI Providers](./packages/ai/CONTEXT.md) - normalizes model requests, responses, and provider failure behavior

## Relationships

- **Pi TUI -> AI Providers**: The TUI presents provider activity and outcomes without owning provider retry policy.
