# ADR-0023: Push Gateway is delivery infrastructure, not a notification inbox

Bluepy's Push Gateway stores subscriptions, delivery settings, dedupe rows, cursors, and short-lived rich snapshots so it can send Web Push notifications. It does not own canonical notification history: Bluepy's notification screen remains AppView-backed, and gateway `notificationId` values identify delivery attempts, not inbox items. This boundary keeps V1 rich push previews from turning the gateway SQLite database into a second notification source of truth.

