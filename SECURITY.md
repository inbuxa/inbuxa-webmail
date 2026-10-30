# Security Policy

## Supported Versions

Security fixes go into the newest release and into every older line still inside its security window. When a new series ships, the one before it gets three more months of security fixes. The full policy is on [Versions and upgrades](https://docs.inbuxa.org/versions/).

| Version | Supported |
| --- | --- |
| `main` and the newest release | :white_check_mark: |
| The previous series, for three months after a new one ships | Security fixes only |
| 2026.x, until three months after 27.1 ships | Security fixes only |
| Release candidates | Replaced by the next candidate |
| Anything older | :x: |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Public issues are visible to everyone, including potential attackers, before a fix is available.

Instead, report security issues privately by emailing:

**securityATcoffeylabsDOTorg**

Please include as much of the following as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- The version or commit of the webmail affected
- The version of the mail server you were testing against, if relevant
- Whether the issue is in the webmail itself, in how it talks to the mail server over JMAP, or in a dependency

### What to Expect

- **Acknowledgment:** You should receive a response within a few days confirming the report was received.
- **Assessment:** The issue will be triaged and its severity assessed. Because the webmail holds no data of its own and relies entirely on the mail server's store over JMAP, some reports may need to be routed to or coordinated with the mail server's own project if the root cause lives there rather than in the webmail's client code.
- **Fix & disclosure:** Once a fix is ready, a new release will be published. We'll coordinate with you on public disclosure timing and credit, if you'd like to be credited.

### Scope

In scope:

- Authentication and session handling in the webmail
- Cross-site scripting (XSS), CSRF, or injection issues in the webmail UI
- Improper handling of JMAP responses that could lead to data leakage between accounts
- Dependency vulnerabilities that are actually exploitable in the webmail's usage

Out of scope (please report upstream instead):

- Vulnerabilities in the mail server itself: see [inbuxa-server's security policy](https://git.coffeylabs.org/inbuxa/inbuxa-server/src/branch/main/SECURITY.md). The address is the same.
- Vulnerabilities in third-party libraries with no demonstrated impact on the webmail
- Issues requiring physical access to a user's device or an already-compromised mail server

## Disclosure Policy

We follow coordinated disclosure: please give us a reasonable window to investigate and release a fix before any public disclosure. In turn, we'll keep you updated on progress and won't leave you waiting indefinitely.

Thank you for helping keep inbuxa Webmail and its users safe.
