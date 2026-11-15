# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead:

**[Report a vulnerability](https://github.com/tomdevtech/ExoFinder/security/advisories/new)** (*Security → Report a vulnerability*)

Please include what you found, where (address or file), and how to reproduce it. ExoFinder is a private, non-commercial project run in spare time: you will get an answer within a week, and a fix as soon as it is understood. Once the fix is live, the advisory is published and you are credited if you wish.

## Scope

- The live site at `https://www.exofinder.space` and its JSON endpoints.
- The code in this repository, including the GitHub Actions workflows.

Out of scope: findings that need a compromised account or device, reports from automated scanners without a demonstrated impact, missing headers that are explained in [docs/SECURITY.md](docs/SECURITY.md), and anything that floods the site. Please do not run load tests or scans that open many connections against the live site; Vercel's DDoS protection blocks such traffic anyway.

## Supported versions

Only the current state of `main`, which is what runs live.

## How the site is protected

[docs/SECURITY.md](docs/SECURITY.md) describes the measures layer by layer, and [docs/TESTING.md](docs/TESTING.md) the tests and checks.
