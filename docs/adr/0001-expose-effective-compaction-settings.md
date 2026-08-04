# Expose raw and effective compaction settings to extensions

The `session_before_compact` event exposes the effective request model, including any auth-derived endpoint, and the effective thinking level, while `CompactionPreparation.settings` retains the raw configured values. This lets extensions use the same request choices as built-in compaction without duplicating model resolution, routing, and capability clamping, while preserving access to user intent.
