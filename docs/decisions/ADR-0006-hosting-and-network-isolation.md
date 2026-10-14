# ADR-0006: Hosting and network isolation for the admin app

Status: Proposed (14 Oct 2026), awaiting Founder decision. Owner: NEXUS.

## Context (verified)
- The admin app is Next.js 16: server-rendered pages, API routes, `mssql`/`tedious` listed in `serverExternalPackages`, DB-backed sessions, no `output: "standalone"`.
- It deploys to Azure Static Web Apps (SWA) Free with hybrid Next.js hosting, via a `workflow_dispatch`-only workflow (#55).
- The Azure SQL firewall uses "Allow Azure services", which admits traffic from any Azure tenant, not only ours (SENTINEL P2 on #55).
- SWA managed functions have no stable outbound IPs, so an IP allow-list on SQL cannot hold.
- Any paid resource needs Founder approval.

## Facts (retrieved 14 Oct 2026; USD list price, pay-as-you-go; monthly = hourly x 730)
| Item | Figure | Source |
| --- | --- | --- |
| SWA Free | $0; 250 MB max app; managed APIs only; no private endpoints; no SLA | https://learn.microsoft.com/en-us/azure/static-web-apps/plans |
| SWA Standard | $9.00/app/month (most regions; Central India not listed in the price API); 500 MB; private endpoints; bring-your-own backend | https://prices.azure.com/api/retail/prices (meter "Standard App"), plans page above |
| SWA hybrid Next.js | Preview; 250 MB max app size; linked APIs (Functions, App Service, Container Apps, APIM) unsupported; linked backend needs Standard + App Service plan at least S1 | https://learn.microsoft.com/en-us/azure/static-web-apps/deploy-nextjs-hybrid |
| SWA private endpoint | Inbound only: it makes the SWA site private. It does not give SWA's managed backend a private path to SQL | plans page above |
| App Service Linux B1, Central India | $0.018/h ≈ $13.14/month | Retail Prices API |
| App Service Linux S1, Central India | $0.088/h ≈ $64.24/month | Retail Prices API |
| App Service Linux P0v3, Central India | $0.082/h ≈ $59.86/month | Retail Prices API |
| App Service VNet integration | Needs Basic tier or higher; no extra charge | https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration |
| Container Apps consumption, Central India | Free per subscription per month: 180,000 vCPU-s, 360,000 GiB-s, 2M requests. After grant: active vCPU $0.000024/s, memory $0.000003/GiB-s, requests $0.40/M | https://azure.microsoft.com/en-us/pricing/details/container-apps/, Retail Prices API |
| Container Apps VNet | Custom VNet with egress control needs a workload-profiles environment; "Consumption only (legacy)" lacks UDR/NAT egress | https://learn.microsoft.com/en-us/azure/container-apps/networking |
| Private endpoint (Private Link) | $0.01/h ≈ $7.30/month, plus $0.01/GB processed in and out (first 1 PB) | Retail Prices API ("Virtual Network Private Link"), https://azure.microsoft.com/en-us/pricing/details/private-link/ |
| Private DNS zone, VNet, NAT | Not verified |  |
| INR prices | Not verified |  |

## Assumptions
- Single admin user, low traffic: a few thousand requests a month and well under 1 GB to SQL.
- Region Central India, matching the SQL server (to confirm).
- Container Apps scales to zero; cold starts of a few seconds are acceptable for an admin tool.
- The Azure SQL database tier and cost stay the same in every option.

## Options
### A. Stay on SWA Free with "Allow Azure services" (current)
- Pros: $0; already deployed; no migration.
- Cons: SQL reachable from every Azure tenant (only password auth protects it); hybrid Next.js is preview; 250 MB cap without standalone; no SLA; deploy not yet proven by a smoke run.
- Cost: $0/month. Effort: none.

### B. SWA Standard plus a private endpoint for SQL
- Pros: stays on SWA; adds SLA and 500 MB.
- Cons: the managed backend cannot join a VNet, so a SQL private endpoint does not help it. A real fix needs a linked App Service backend (S1 or higher) and linked backends are unsupported for hybrid Next.js in preview. B as stated does not close the P2.
- Cost: $9 + $7.30 = about $16/month without fixing the risk; about $81/month with an S1 linked backend. Effort: medium, blocked by the preview limit.

### C. App Service Linux with VNet integration plus SQL private endpoint (SWA dropped)
- Pros: standard Node hosting for SSR and `mssql`; stable, supported VNet path; can disable SQL public access entirely; no app-size cap; deploy with `output: "standalone"` and a GitHub Action.
- Cons: always-on fixed cost; one more resource to run.
- Cost: B1 $13.14 + PE $7.30 ≈ $20.50/month (P0v3 ≈ $67/month if B1 is too slow). Effort: small to medium: add standalone build, new workflow, VNet, subnet, private endpoint and DNS zone, move app settings.

### D. Container Apps (workload-profiles environment, consumption profile) with VNet plus SQL private endpoint
- Pros: scales to zero; usage likely inside the free grant; supported VNet path.
- Cons: needs a container image, a registry and an image build pipeline; cold starts; more moving parts; registry cost not verified.
- Cost: compute about $0 inside the free grant + PE $7.30 ≈ $7–10/month plus registry (not verified). Effort: medium.

## Recommendation
Option C on B1. It is the cheapest option that is generally available, runs SSR and `mssql` as plain Node, and lets us turn off SQL public access, which closes the P2. D is cheaper on paper, but adds a container pipeline and cold starts that a single-admin app does not need. B does not fix the risk while hybrid Next.js is in preview.

## Decision gates
- No environment is called "live" until a smoke run on the deployed URL passes: log in, create a post, publish, unpublish, archive. Use a clearly named test post and keep credentials out of logs.
- After the move, SQL "Allow Azure services" and public network access are turned off, and the app is re-smoked.

## Open questions for the Founder
- Monthly budget ceiling for hosting and networking.
- Region: confirm Central India for the app and SQL.
- Is B1 (1 core, no autoscale, ~$13/month) acceptable, or do you want P0v3?
- Keep SWA for anything (static only) or drop it?

## Revisit when
SWA hybrid Next.js reaches general availability with linked backends, traffic grows past one B1 instance, or the budget changes.
