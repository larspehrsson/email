# Trust report

*Draft. What Email connects to, what it keeps, and how it protects you, written so you can
judge it for yourself. The summary comes first; each part below it has the details, with links
to the code that does it.*

## At a glance

| What | In short |
|---|---|
| **Sent to the developers** | Nothing. No analytics, no crash reports, no usage statistics, no account with us. |
| **Who Email talks to** | Your own mail servers. Beyond that, only services you turn on (Google Contacts, Microsoft tags and snooze, writing help, sender pictures), the senders' servers for pictures you choose to load, and GitHub to look for updates. |
| **Started by** | You, or a schedule you can see and turn off. A message arriving contacts nothing but your own mail server, unless you turned on sender pictures. |
| **Where your mail is kept** | On this computer, in Email's data folder. Passwords and sign-in tokens are in the system's keychain, not in files. |
| **Encryption** | Every connection uses verified TLS, except one case you choose (a picture from a plain `http://` address). Mail on disk isn't encrypted by Email: use your system's disk encryption. |
| **Remote content** | Pictures and other content from the web are blocked until you allow them, for one message, a sender, or a sender's whole domain. |
| **Code that runs from email** | None that we know of. Messages are cleaned of scripts and shown in a locked-down frame that allows none. |
| **Updates** | Signed. Each update is checked against a key built into Email before it's installed. |
| **Source** | Open, at [github.com/rickhall/email](https://github.com/rickhall/email). The builds you download are made from it by GitHub's build service, in public. |

## Connections

Every kind of connection Email can make. *Started by* says what makes it happen. *Off by
default* means nothing is sent until you turn it on.

| Goes to | When | Started by | What's sent | Your control |
|---|---|---|---|---|
| **Your mail servers** (IMAP to read, SMTP to send) | While Email runs: new mail as it arrives, and your actions (send, move, delete, mark…) | You, and keeping your mail up to date | Your sign-in, and the mail you send or change | Add or remove accounts in Settings › Accounts |
| **Your domain's DNS** (its MX records) | Once, when you add an account whose server Email doesn't know | You | Your email's domain name, to your system's DNS server | Enter the server yourself |
| **Google sign-in** (`oauth2.googleapis.com`) and **Microsoft sign-in** (`login.microsoftonline.com`) | When you sign in (in your browser), and to renew the sign-in now and then | You | Your sign-in and its renewal token | Sign in with an app password instead |
| **Google Contacts** (`people.googleapis.com`) | When the address book opens, after you change a contact, and every 15 minutes | You, once you connect it | Your contacts, both ways | Off by default. Settings › Accounts › Google Contacts |
| **Microsoft Graph** (`graph.microsoft.com`) | Every few minutes, and when you tag or snooze | You, once you turn it on | Tags (categories) and reminders on Microsoft accounts; a message you mark as spam is reported to Microsoft | Off by default. Settings › Accounts › Tags & snooze |
| **Writing help** (`api.anthropic.com`) | Only when you ask it to write or rewrite | You, each time | Your name and address, the subject and recipients, the message you're replying to, what you've written, and your instruction, with your own API key. In a message's source view, Ask sends the whole message with its headers | Off until you add a key. Settings › AI |
| **Senders' domains**, for their pictures (a DNS lookup for their BIMI logo, then their website's icon; either can name a picture on another server, which is fetched too) | When a message's sender has no picture yet; once per domain, kept for 30 days | You, by choosing a level | The domain's name (your DNS resolver sees it too), and a request for its logo or icon from your address | Off by default. Settings › General › Sender pictures: contacts only, domains you write to, or all |
| **Google's photo servers**, for a Google contact's own photo | Once per photo | You, by connecting Google Contacts | A request for the photo | Only with Google Contacts connected |
| **Servers of pictures in a message** | When a message you allowed is shown | You, per message, sender or domain | A request for the picture, which tells its sender the message was opened, and from which address | Blocked by default |
| The same, **over plain `http://`** | When such a picture fails over https (Email fetches it itself) | You, as above | As above, but the address isn't encrypted on the network | Only for messages you allowed. Settings › General › Privacy › Insecure pictures |
| **GitHub** (`github.com`), for updates | 20 seconds after Email starts and every 6 hours | The schedule | A request for the newest version's description, and the download when there is one | Settings › General › Privacy, or Troubleshooting › Updates |

**Never on the network:**
- **Links** you click open in your web browser; Email itself doesn't visit them.
- **Your computer's name:** Email greets your outgoing mail server as `[127.0.0.1]`, so the
  name doesn't end up in the headers recipients see.
- **AI apps** (Claude Desktop, Claude Code and other MCP apps) reach Email through a socket on
  this computer only, in a folder only you can open. They're off by default, and get no mail
  tools until you turn them on. Each permission is a switch of its own, and sending or deleting
  asks you every time.

## What's kept, and where

Email's data folder:
- **Linux:** `~/.local/share/dev.mailclient.desktop`
- **macOS:** `~/Library/Application Support/dev.mailclient.desktop`
- **Windows:** `%APPDATA%\dev.mailclient.desktop`

| What | Where | Contains |
|---|---|---|
| Mail list | `mail.db` | Folders, message headers (sender, recipients, subject, date), tags, drafts, the address book, and the search index of message text |
| Messages | `bodies.db` | The messages themselves, and attachments if you keep them for offline use |
| Passwords and tokens | The system keychain (one item, `dev.mail-client`) | Account passwords, sign-in tokens, your writing-help API key, and your Google sign-in client |
| Log | `logs/` in the data folder (macOS: `~/Library/Logs/dev.mailclient.desktop`; Windows: `%LOCALAPPDATA%\dev.mailclient.desktop\logs`) | What Email did and any problems: account addresses, folder and server names, and timings, and which tools AI apps used; no subjects or message text |
| Opened attachments | The system's cache folder, in a folder only you can open | Copies to open in other apps; cleared each time Email starts |
| Saved attachments and exports | Downloads, or where you choose | What you saved |
| Settings | The app's own storage, and a few small files, in the data folder | Your choices in Settings and View options, window sizes, AI apps' permissions |
| The web view's cache and cookies | The data folder | Pictures you loaded, and cookies their servers set (a tracker's, typically): removed at every start and every hour |

On Linux and macOS the data folder opens only to you, so other people with accounts on the same
computer can't read your mail there.

Removing an account deletes its mail and its keychain entries from this computer. It changes
nothing on the server. Your lists of senders and domains whose pictures always load stay.

## How you're protected

- **Email can't run code that arrives in mail.** Messages are cleaned before they're shown, with
  scripts, event handlers, `javascript:` links and links to `data:` pages removed, and shown in a
  sandboxed frame whose content policy allows no scripts (`mime::sanitize_html`, `buildSrcdoc`).
- **Remote content is blocked by default,** so senders can't tell you opened a message until you
  allow it. Where your mail service checks who mail is from (Gmail and Microsoft always do, and
  others that sign their check with their own name), a rule to always load a sender's pictures
  counts only for mail that passed that check (DMARC or DKIM). Rules for everyone at a company
  are off unless you turn them on (Settings › General › Privacy).
- **Links that deceive are flagged** when you point at them: text naming one site that leads to
  another, look-alike letters, bare internet addresses, and links that go nowhere.
- **Fetches Email makes for pictures stay on the public internet.** They never reach this
  computer or your local network, are checked again after each redirect, and must actually be a
  picture.
- **Only known kinds of documents, pictures, sound and video open directly.** Anything else
  (programs, scripts, shortcuts, disk images, web pages, Office files with macros) is only saved.
  On Windows and macOS, what Email saves or opens is marked as downloaded from the internet, so
  the system warns, or opens it in a protected mode.
- **Connections are verified.** Every server's certificate is checked, except for the
  plain-`http://` pictures above.
- **Updates are signed** and checked before they're installed; the macOS app is also notarized
  by Apple. On Linux, an `.rpm` update is installed from a folder only you can open.

## Things to know

- **Mail on disk isn't encrypted by Email.** Anyone who can read your files can read your mail:
  use your system's disk encryption.
- **Loading a message's pictures tells the sender** you opened it, when, and from which address.
  A plain-`http://` picture's address can also be seen on the network.
- **Sender addresses can be forged.** Where your mail service doesn't check who mail is from in a
  way Email can rely on, "always load pictures from this sender" trusts the From address as
  written, and so does a rule for everyone at a company if you turn those on. Someone pretending
  to be that sender could then see when you open their message.
- **Pictures you allow can be on your local network,** and the web view will request them.
- **On Linux, saved attachments carry no "downloaded from the internet" mark:** Linux has no
  standard one.
- **Notifications show the sender and subject** of new mail unless you turn that off (Settings ›
  General › Privacy, or Notifications); then they only say there's new mail.
- **AI apps:** one switch turns them on for every AI app, and an app names itself.
- **The build:** dependencies aren't yet audited automatically for known vulnerabilities, and
  the Linux and Windows installers aren't signed by the operating system's vendors. (Every build
  step is pinned to an exact version.)
- **Release builds include the web view's Developer Tools.**

## Keeping this report honest *(planned)*

Today this report is written by hand ([`trust/trust.json`](trust/trust.json) has every claim
with its evidence; [`trust/VERIFY.md`](trust/VERIFY.md) is how to check it). The plan:
- **Every connection the code can make is listed in a file,** and the build fails when code adds
  one that isn't listed.
- **This page is regenerated with each release,** with the date and version it describes.
- **The report adds a dependency audit and a security score** for the project
  ([OpenSSF Scorecard](https://scorecard.dev)).
