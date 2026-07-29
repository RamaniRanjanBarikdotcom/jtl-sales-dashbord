# Event Taxonomy

Controlled names are defined in `backend/src/common/events/event-types.ts`. New event names require review; dynamic user-provided event names are not accepted. Heartbeats update agent state and are not permanently emitted on every interval to avoid event-volume inflation.
