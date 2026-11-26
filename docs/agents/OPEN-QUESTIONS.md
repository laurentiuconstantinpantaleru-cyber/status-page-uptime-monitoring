# Open questions — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> Unknowns. Work that depends on an open question is out of scope until it is
> answered. Only the user answers; an agent never answers by guessing. An agent may
> write a `Proposed answer` the evidence supports; the question stays
> `investigating` until the user confirms it.
> Answered entries stay, with the answer and date, and usually become a D- or PATTERN-.
<!-- graffino-agentic:end -->

## Index
### [Admin](questions/admin.md)
- Q-008 · How do users sign in to the admin interface? · _answered_
- Q-019 · Where and how does the admin panel show worker_fault episodes?

### [Api](questions/api.md)
- Q-016 · Where do the API and status badge docs live? · _answered_
- Q-018 · What do the API's requests and responses look like? · _answered_
- Q-022 · Where does the public status page's API link point?

### [Architecture](questions/architecture.md)
- Q-006 · How does the web in-memory cache learn about worker state changes? · _answered_
- Q-007 · How often does the web process read the cache version number? · _answered_

### [Incidents](questions/incidents.md)
- Q-002 · What are the thresholds for N (open incident) and M (resolve incident)? · _answered_
- Q-003 · What is the alert escalation contact and timeout policy? · _answered_
- Q-004 · Which email transport/provider will be used for alerts and reports? · _answered_
- Q-009 · How are recurring maintenance windows expressed? · _answered_
- Q-020 · Can quick maintenance be stopped before it expires?
- Q-021 · Who writes incident updates, and does that code bump `status_version`? · _answered_

### [Monitoring](questions/monitoring.md)
- Q-001 · Which 10 student project URLs and 2 local business URLs will be monitored? · _investigating_
- Q-010 · What latency threshold do the seeded business monitors use?

### [Project](questions/project.md)
- Q-005 · What are the specific requirements requested in the 3 student interviews? · _answered_

### [Status page](questions/status-page.md)
- Q-011 · Which time zone does the public status page show times in? · _answered_
- Q-012 · What period and which monitor does the public response time chart show? · _investigating_
- Q-013 · How far back does the public status page list past incidents? · _answered_
- Q-014 · How are monitors grouped on the public status page? · _answered_
- Q-015 · Which status wins when several apply, in the overall banner and in a daily bar? · _answered_
- Q-017 · Does the public status page share DS-p26-header or keep its own header variant?

