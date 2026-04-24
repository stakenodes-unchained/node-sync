# PostgreSQL Migration Checklist (Phase 2)

## Goals
- Move from single-instance SQLite storage to PostgreSQL for safer concurrency and scale.
- Preserve tenant isolation guarantees (`tenant_id` scoped access).
- Keep plan/subscription logic behavior identical during migration.

## Schema Mapping
- `users`: keep `email` unique, migrate `password_hash` as text.
- `tenants`: keep `account_type` check constraint and optional `organization_name`.
- `memberships`: keep unique `(user_id, tenant_id)` and role.
- `subscriptions`: keep unique `tenant_id`, Stripe IDs, and `node_soft_limit`.
- `nodes`: keep `tenant_id` foreign key and unique `(tenant_id, name)`.
- `node_status_history`: keep foreign key to `nodes`, add index on `(node_id, checked_at DESC)`.

## Data Migration Steps
1. Create PostgreSQL schema with equivalent foreign keys and unique constraints.
2. Export SQLite data in dependency order:
   - `users`, `tenants`, `memberships`, `subscriptions`, `supported_chains`, `nodes`, `node_status_history`.
3. Import while preserving integer IDs to avoid cross-table remapping.
4. Validate row counts and spot-check tenant-level data boundaries.

## Application Changes
- Introduce a DB adapter layer with identical method names used in `server.js`.
- Keep all tenant-scoped queries explicit (`WHERE tenant_id = $1`).
- Move transactions currently using SQLite `transaction` wrappers into PostgreSQL transactions.
- Replace SQLite datetime defaults with PostgreSQL `NOW()`.

## Operational Plan
1. Deploy dual-read validation in staging.
2. Backfill and verify subscription entitlements from Stripe webhooks.
3. Run smoke tests:
   - register/login
   - add/edit/delete node
   - status polling/history
   - free/pro limits and billing flow
4. Cut over by toggling database adapter configuration.
5. Keep SQLite snapshot for rollback window.
