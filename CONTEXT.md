# CONTEXT — p26-status

<!-- graffino-agentic:begin v1 -->
> Domain terms for this project. Use these words in code, docs, commits and plans.
> When you see an avoided word in new code, replace it.
<!-- graffino-agentic:end -->

## Terms

- **Monitor**: An automated check configuration targeting a single URL or service with specified interval, expected status code, timeout, and optional keyword. _Avoid: probe target, ping item._
- **Incident**: A confirmed downtime or degradation event with a start time, end time, recorded root cause, and optional operator updates. _Avoid: outage ticket, bug._
- **Check / Probe**: A single execution of an HTTP/TLS check by a worker against a monitor target. _Avoid: ping, query._
- **Worker**: An independent check process responsible for executing probes and reporting raw outcomes. _Avoid: agent, bot._
- **Confirmation**: A secondary validation executed by an independent worker to prevent false positive alerts caused by local worker network issues. _Avoid: double check, 2FA._
- **Escalation**: Forwarding an unresolved incident notification to a secondary contact if unacknowledged within 15 minutes. _Avoid: alert forwarding._
- **Maintenance Window**: A pre-scheduled time range during which checks continue or pause, alerts are suppressed, and downtime is excluded from uptime ratio calculation. _Avoid: downtime window._
- **Uptime Ratio**: The availability percentage calculated as `available_time / (total_time - maintenance_time)` derived from incident durations across a calendar period. _Avoid: ping success rate._
- **Status Page**: A public-facing organization view displaying component statuses, active/past incidents, response time charts, and uptime percentages, served with sub-100ms latency. _Avoid: dashboard, landing page._
- **Roll-up**: The scheduled batch compaction of raw check data older than 7 days into hourly and daily summary records. _Avoid: cleanup, aggregation dump._
