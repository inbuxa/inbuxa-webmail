<p align="center">
  <img src="web/public/img/inbuxa-mark.png" alt="" width="110">
</p>

<h1 align="center">INBUXA webmail</h1>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0-or-later" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-2dd4bf?style=flat-square"></a>
</p>

> [!NOTE]
> Development happens on [git.coffeylabs.org/inbuxa/inbuxa-webmail](https://git.coffeylabs.org/inbuxa/inbuxa-webmail); the copy on GitHub is a read-only mirror.
> Report issues at **[git.coffeylabs.org/inbuxa/inbuxa-webmail/issues](https://git.coffeylabs.org/inbuxa/inbuxa-webmail/issues)**, and join discussions at **[community.coffeylabs.org](https://community.coffeylabs.org)**.
>
> This repository was called `ihasmail-inbuxa` until October 2026. Container images are now published as `inbuxa/inbuxa-webmail`; the old `inbuxa/ihasmail-inbuxa` image stops at `2026.9.26-g654d298`.

The webmail of the INBUXA suite: mail, calendars, contacts, files and filters
in one app that works as well on a phone as on a desktop. It talks only JMAP to
the INBUXA mail server, and keeps nothing of its own: everything durable,
settings included, lives on the server, so the container is disposable.

## What's in it

- **Mail:** conversations, labels, search operators, keyboard shortcuts,
  scheduled and undo send, invitations and RSVP, filters made from a message.
- **Calendar:** month, week, day and agenda views, recurrence, attendees and
  free-busy.
- **Contacts:** address books, groups, vCard import and export.
- **Files:** browse, upload, move, share.
- **Signature checking:** S/MIME signed mail verified as you read it.
- **Settings that follow the account**, stored on the mail server.
- **On a phone:** swipe to archive or delete, pull to refresh, hold to select.
- **Administration:** a dashboard, accounts, groups, mailing lists, roles,
  tenants and domains, each shown only to an account whose role allows it.
  Everything else is in INBUXA Admin.
- **Sign-in on the mail server's own page**, two-factor included. The webmail
  never handles a password to sign someone in, and holds only sealed tokens.
- **Eleven interface languages and twelve themes.**

## Configuration

| Variable | Meaning |
|---|---|
| `MAIL_SERVER_URL` | How this webmail reaches the mail server. |
| `APP_SECRET` | A long random secret for sealing sessions. Required in production. |
| `OAUTH_CLIENT_SECRET` | Turns on sign-in through the server's page. The secret of the confidential client the server registers for this webmail: on the server, the same value as `INBUXA_WEBMAIL_CLIENT_SECRET`. |
| `OAUTH_CLIENT_ID` | The client's id. Default `ihasmail-inbuxa`, which is what the server registers. |
| `PUBLIC_URL` | Where browsers reach the webmail, without `BASE_PATH`. Required with `OAUTH_CLIENT_SECRET`. The redirect URI, `PUBLIC_URL` + `BASE_PATH` + `/api/auth/callback`, must match the server's `INBUXA_WEBMAIL_URL` + `/api/auth/callback` exactly. |
| `MAIL_SERVERS_FILE` | Optional: several mail servers, picked by the account's domain. See `mail-servers.example.json`. |
| `ADMIN_URL` | Optional: where INBUXA Admin is, for the dashboard's link. |
| `APP_NAME` | What the webmail calls itself. Default `INBUXA`, shown as the INBUXA wordmark; any other name shows as text. |

`.env.example` lists the rest.

On the mail server, set `INBUXA_WEBMAIL_URL` to the webmail's address (with
`BASE_PATH`, if any) and `INBUXA_WEBMAIL_CLIENT_SECRET` to the shared secret.
The server registers the client on start and allows the webmail's origin for
cross-origin requests.

With one mail server, the sign-in page asks for no address, only whether this
is the person's own device. The server's page asks for the rest. With several,
the address comes first, since its domain picks the server.

A password change revokes the server's tokens, so it signs the person out
everywhere, this session included.

## Quick start (Docker)

```bash
cp .env.example .env
# edit: MAIL_SERVER_URL, APP_SECRET, and for server sign-in OAUTH_CLIENT_SECRET and PUBLIC_URL
docker compose up --build -d
# → http://localhost:8080. Put a reverse proxy in front for TLS.
```

## Source code

INBUXA webmail is a modified ihasmail, so the AGPL's offer is this fork:
<https://git.coffeylabs.org/inbuxa/inbuxa-webmail>. The sign-in page and Settings ›
About link there, beside the version, which names the commit the running build
came from.

Run your own patched build and that offer becomes yours, not ours: point
`SOURCE_URL` at your tree and both links follow it.

## Development

```bash
npm install
npm run dev:mock     # the built-in mock mail server (demo@example.com / demo)
npm test
```

The mock also answers OAuth. Start it and the webmail with
`OAUTH_CLIENT_SECRET=mock-oauth-secret` and a `PUBLIC_URL`, and its sign-in
page approves the demo user at once.

Architecture, the mock's switches and how versions are numbered are in
[CONTRIBUTING.md](CONTRIBUTING.md#development-setup).

## Built on ihasmail

The INBUXA webmail is built on [ihasmail](https://git.coffeylabs.org/coffey-labs/ihasmail),
Coffey Labs' own webmail, which stays an independent product. The public
repository is the remote `ihasmail`, fetch-only, and its `main` is merged in to
keep up. Nothing here is pushed there.

## License

Copyright (C) 2026 Coffey Labs. AGPL-3.0-or-later; see [LICENSE](LICENSE).
