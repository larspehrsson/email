# Verifications

Results of checking [`trust.json`](../trust.json) by [`VERIFY.md`](../VERIFY.md), one file each,
in the schema's `verification` format. Each names its verifier and the commit it checked. A
later report may fix what a result found, so read a result against the report it checked.

- **[2026-11-24-agent-1.json](2026-11-24-agent-1.json):** the first check, by an AI agent that
  hadn't seen the report being written, given only `VERIFY.md` and the code. It confirmed 19 of
  31 claims, refuted 11, and found 17 things left out (one serious: a forged "from you" message
  could make a stranger's domain count as one you write to). The report was then corrected, and
  these were fixed in the code:
  - the forged "from you" message no longer counts;
  - links to `data:` pages, and link targets, are removed from messages;
  - only known kinds of documents, pictures, sound and video open directly;
  - `.rpm` updates install from a folder only the user can open;
  - the SMTP greeting no longer gives the computer's name.

  The rest are listed under the report's weaknesses.
