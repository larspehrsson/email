# Verifying a trust report

Instructions for whoever checks a trust report: an AI agent given this file as its task, or a
person. They're written to be followed as they are. The report is `trust.json`, following
[`trust.schema.json`](trust.schema.json); the rules are in [`SPEC.md`](SPEC.md).

## Your task

You're checking whether a program's trust report is **complete** and **true**, at the commit it
names. You're not its author and owe it nothing: assume it may be wrong, and look for where. A
report that leaves something out is worse than one that gets a detail wrong, so look for what's
missing first.

## Before you start

1. Check out the commit in `subject.commit`. Note it in your result; if you can't use that
   commit, say which one you used.
2. Read `SPEC.md` for what each field means.
3. **Don't read the report's claims yet.** Do step 1 below on your own first, so the report
   doesn't shape what you look for.

## 1. Completeness: what does the program really do?

Search the code yourself. List, with file:line for each:
- **Every way it can reach the network:** sockets, HTTP clients, DNS lookups (including through
  libraries), embedded web views and what they're allowed to load (look at their content
  security policies and what can set their content), helper programs it runs, update
  mechanisms, and anything listening on a port or socket. Look at build and release
  configuration too (updater endpoints, CI-written settings).
- **What starts each one:** a user's action, a schedule, startup, or content that arrived (an
  email, a web page, a server's answer). Content-started ones matter most: a stranger decides
  when they happen.
- **Every place data is kept:** databases, files, caches, logs, temporary files, the system's
  keychain, a web view's own storage, exports.
- **Every input a stranger can shape,** and what contains it.
- **Anything sent to the developers,** however small (version checks count).

Useful searches, in any language: socket and TLS libraries, `connect`, `fetch`, `http`, `https`,
`dns`, `resolve`, `lookup`, `listen`, `bind`, `spawn`, `exec`, `Command`, URL literals,
`localStorage`, `indexedDB`, file writes, keychain or keyring use, content security policies.

Then read the report and compare. Everything in your list that the report doesn't cover goes in
`missing`, with a severity:
- **high:** data reaches someone the report doesn't name, or a connection that content can
  start isn't listed;
- **medium:** a connection or store is listed but described wrongly in a way that matters (a
  different trigger, default, or what's sent);
- **low:** detail.

## 2. Claims: is each one true?

For each claim in every section, and each `none`:
1. Follow its `verify` steps at the subject commit.
2. Look for what `refuted_if` describes. Try to find it; don't just confirm the evidence exists.
3. Check its fields against what you found: `trigger`, `default`, `encryption`, `sends`,
   `reveals`, `holds`, `encrypted_by_app`, `removed_by`.
4. Check its `level`: `tested` needs a test that would fail if the claim stopped being true;
   `enforced` needs a check that runs on every build over all the code; `audited` needs a named
   outside audit of a stated commit. Set `level_justified`.
5. Give a verdict:
   - `confirmed`: you checked it and found nothing against it;
   - `refuted`: you found something against it (say what, with file:line);
   - `unclear`: you couldn't settle it (say what you'd need).

Then check the summary: each statement must be supported by the claims it `rests_on`, and say no
more than they do.

## Rules for your answer

- **Evidence for everything.** Every verdict and every missing item names file:line. A verdict
  without it is `unclear`.
- **Don't trust comments or documentation** in the code as proof; read the code that does it.
- **Say what you didn't do:** parts you couldn't read, a commit you couldn't use, claims you
  skipped.
- **Don't fix anything.** Report only.

## Your result

Return JSON following `#/$defs/verification` in `trust.schema.json`:

```json
{
  "verifier": "who you are (a person's name, or the agent and model)",
  "commit": "the commit you checked",
  "date": "YYYY-MM-DD",
  "claims": [
    { "id": "connections.ai", "verdict": "confirmed", "found": "…, file:line", "level_justified": true }
  ],
  "missing": [
    { "section": "connections", "what": "…", "where": "file:line", "severity": "high" }
  ],
  "notes": "what you didn't check, and anything else worth knowing"
}
```

Then, in a few sentences, say what a user should take from it.
