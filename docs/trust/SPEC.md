# Trust Report specification

*Draft 0.1. Developed with Email, the first project to use it; meant to become a standard of its
own.*

A trust report tells people what a program does with their data and their network, in a form
they can read in a minute and anyone can check against the code. It's a file of **claims**
(`trust.json`, following [`trust.schema.json`](trust.schema.json)) from which a readable page is
made. Each claim says where in the code it's true, how to check it, and what would prove it
wrong, so a person or an AI agent can verify the report ([`VERIFY.md`](VERIFY.md)) instead of
taking the developers' word for it.

## Principles

1. **The same questions for every program.** A report answers every required section below.
   Readers can compare two programs, and a missing answer is visible.
2. **No silence.** A section that doesn't apply says so (`"none": true`, with a reason).
   Leaving something out must never look the same as "none".
3. **Every claim can be checked.** It names its evidence (files, functions, tests, build
   checks), how to check it, and what would refute it.
4. **Say how well it's backed.** Each claim has a level: *declared*, *tested*, *enforced* or
   *audited*. A promise and a guarantee look different.
5. **Pinned to the code.** A report names the commit it describes. Verification happens at that
   commit.
6. **Plain words first.** Every claim has a sentence a non-programmer can read. The technical
   detail is there for whoever wants it.
7. **The weak spots are part of the report.** A report must list what a careful reader should
   know (section `weaknesses`). A report with none listed is not believed.

## Terms

- **Claim:** one statement about the program, with its evidence. Everything in a report is a
  claim, so everything can be verified.
- **Evidence:** where the claim is made true or shown: code (a file and a function or other
  symbol), a test, a build check, configuration, or an outside audit.
- **Level:** how well the evidence backs the claim:
  - `declared`: the developers say so; the evidence shows where to look.
  - `tested`: a test in the project shows it (and would fail if it stopped being true).
  - `enforced`: the build fails if it stops being true, for every change (a check that runs on
    the whole code, not just a test of one case).
  - `audited`: someone independent checked it; the evidence names who, when and at which commit.
- **Subject:** the program and the commit the report describes.
- **Operator:** who runs a server: `user` (a server the user chose, such as their own mail
  server), `developer` (the project, its developers, or anyone working for them), or
  `third-party` (anyone else), with a name when known.

## Required sections

Every report has all of these. Each is a list of claims, or `"none": true` with a reason.

### `developer`: what reaches the developers

Every connection to a server the developers operate or pay for: telemetry, crash reports,
analytics, update checks, licensing, feature flags, remote configuration, error logging, and
downloads they host. If nothing does, the section is `"none": true`; that claim is then checked
like any other ("refuted if" any connection's operator is the developers).

A service hosting the project's downloads (GitHub releases, an app store) counts here when the
program contacts it itself.

### `connections`: every way the program reaches the network

One claim per kind of connection, including:
- connections the program opens itself, and ones made for it by a library, a framework, an
  embedded web view, the system (DNS lookups), or a helper program it runs;
- connections started by content the program receives (an email's pictures, a link preview, a
  lookup of a sender's domain), which must use the trigger `content`;
- listeners: ports or sockets the program opens for others to connect to, local or not.

Each claim fills the connection fields (see *Claims*). A connection to a server the user
configured is one claim for the kind ("your mail servers"), not one per server.

### `third-parties`: who else receives anything

Every operator, other than the user's own servers and the developers, that any connection
reaches: what it receives and why. It must agree with `connections`.

### `storage`: what's kept, and where

One claim per place data is kept: files, databases, caches, logs, the system's keychain,
browser-style storage of an embedded web view, temporary files, exports. For each: where, what
categories of data, whether the program encrypts it, how long it's kept, and what removing an
account or uninstalling removes.

### `secrets`: passwords, tokens and keys

Where each kind is kept, who can read it, and whether it ever leaves the computer, and to whom.

### `untrusted-input`: what from outside can reach the program, and how it's contained

Every input that a stranger can shape (received messages, attachments, web pages, files the user
opens, data from servers), and what stops it from running code, reading files or reaching other
systems.

### `updates`: how new versions arrive

How the program finds and installs updates, how an update is shown to be genuine (signatures,
whose key), where builds are made, and whether a build can be reproduced. `"none": true` if it
never updates itself.

### `supply-chain`: what it's built from

Dependencies, how they're pinned and audited, and where the build happens.

### `permissions`: what it asks of the system

Each system permission or capability it uses (network, the keychain, notifications, files,
camera, microphone, location, accessibility, running at login) and why.

### `weaknesses`: what a careful reader should know

Limits and risks, stated plainly: data kept unencrypted, information revealed to others,
features that weaken a protection when turned on, things not yet verified. Each is a claim, with
its evidence.

## Claims

Every claim has:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable identifier, `section.name` (`connections.ai`) |
| `claim` | yes | The statement, in plain words |
| `level` | yes | `declared`, `tested`, `enforced` or `audited` |
| `evidence` | yes | At least one: `{kind, path, symbol?, note?}`; `kind` is `code`, `test`, `build-check`, `config`, `doc` or `audit` |
| `verify` | yes | How to check it: concrete steps, or a command |
| `refuted_if` | yes | What would prove it wrong: what a verifier should look for |
| `details` | no | More, for whoever wants it |

A **connection** claim also has:

| Field | Values |
|---|---|
| `destination` | A host name, or a description of a class ("the user's mail servers", "the server named in a message's picture") |
| `operator` | `user`, `developer` or `third-party`, and `operator_name` when known |
| `direction` | `outgoing` or `listening` |
| `scope` | `internet`, `local-network` or `this-computer` |
| `trigger` | One or more of: `user-action`, `user-schedule` (a schedule the user turned on), `app-schedule`, `startup`, `content`, `account-sync` |
| `frequency` | In words ("every 6 hours", "once per domain, kept 30 days") |
| `default` | `on`, `off` or `always` (can't be turned off) |
| `control` | How to turn it off, in words |
| `encryption` | `tls-verified`, `tls-unverified`, `plaintext`, `local-only` (never leaves the computer) |
| `sends` | Data categories (below) |
| `reveals` | What the other side learns about the user: `ip-address`, `account-identity`, `device-info`, `app-version`, `reading-activity` (that something was opened, and when), `contact-relationships` |

A **storage** claim also has:

| Field | Values |
|---|---|
| `location` | Where, per platform if it differs |
| `holds` | Data categories |
| `encrypted_by_app` | `true` or `false` |
| `retention` | How long, in words |
| `removed_by` | What removes it: `account-removal`, `uninstall`, `user-action`, `app-restart`, `never` |

**Data categories:** `message-content`, `message-headers`, `attachments`, `contacts`,
`credentials`, `api-key`, `draft-content`, `settings`, `usage`, `diagnostics`, `domain-names`,
`app-version`, `other` (with a note).

## The summary

A report has a short summary for people who'll read nothing else: at most ten statements, each
naming the claims it rests on (`rests_on`). The summary's level is the lowest level among those
claims, and it's shown beside the statement. A summary statement may not say more than its
claims do.

## Verification

Verifying a report means two things ([`VERIFY.md`](VERIFY.md) has the instructions for an agent
or a person):
1. **Completeness:** look for what the report leaves out: every way the program can reach the
   network, keep data, or take untrusted input, compared with the report. This comes first,
   and matters most: a report can be accurate in everything it says and still leave things out.
2. **Claims:** check each claim at the subject commit, by its `verify` steps, looking for what
   `refuted_if` describes.

The result (`verification` in the schema) says, for each claim, `confirmed`, `refuted` or
`unclear`, with the evidence found, and lists anything missing. Results from different verifiers
(other agents, other people) can then be compared. A project may publish them next to its report.

## Versioning

The report names the specification version it follows (`spec`). This is `0.1`: a draft, and
expected to change as more projects use it.
