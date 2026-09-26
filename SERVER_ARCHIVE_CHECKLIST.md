# Branch archive server checklist

- [x] Authoritative file: `branch-archive-top3.json`
- [x] Browser reads server JSON with `cache: no-store`
- [x] Browser does not use legacy local branch archive
- [x] Server frozen is created only before target time
- [x] Closed fact appends result without rewriting frozen payload
- [x] Workflow runs every 5 minutes and on TOP-3 live updates
- [x] PWA network-first includes the shared archive
- [x] Desktop/mobile interaction test covers server archive mode
