# Default unknown Codex stream failures to retryable

Codex WebSocket failures with a dedicated recovery contract keep that contract, and known terminal error codes fail immediately. Unless retries are explicitly disabled, other in-band failures get at least one retry before the Replay-Safe Boundary because backend error codes evolve and unknown failures may be transient; this trades bounded extra latency and requests for recovery without requiring a client release for every new transient code.
