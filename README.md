# Email

A fast desktop email app for Linux and macOS. All your accounts in one window, your mail kept
on your computer so everything opens instantly, and a keyboard for everything.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/inbox-dark.png">
  <img src="docs/screenshots/inbox.png" alt="The main window: accounts and folders, the message list, and a conversation">
</picture>

## Download

Get the newest build from the [Latest build](https://github.com/rickhall/email/releases/tag/latest)
page:

- **macOS:** the `.dmg` (Apple Silicon and Intel). Open it and drag Email to Applications.
- **Fedora and other RPM-based Linux:** the `.rpm`, installed with `sudo dnf install ./Email-*.rpm`.
- **Debian, Ubuntu:** the `.deb`, installed with `sudo apt install ./Email_*.deb`.
- **Any other Linux:** the `.AppImage`. Make it executable and run it.

Installing a newer build over an older one upgrades it; your mail and settings stay.

## Adding your accounts

Click **+** in the sidebar and enter your address.

- **Outlook.com, Hotmail and Microsoft 365:** you sign in on Microsoft's own page in your
  browser. Work and school accounts need IMAP allowed by their administrator.
- **Gmail:** use an [app password](https://myaccount.google.com/apppasswords) (it needs
  2-Step Verification turned on), not your Google password.
- **Any other provider:** your address and password. The servers are found for you; if not,
  enter them under **Advanced**.

Passwords and sign-ins are kept in your system's keychain. The first sync downloads your
mail in the background; you can read and write while it runs.

## What it does

**Every account in one window.** Gmail (with its labels), Outlook and any IMAP server side by
side. The list scrolls through tens of thousands of messages without waiting, and new mail
arrives as it's delivered. Conversations are grouped together, even across folders.

**Writing mail** happens in its own window: rich text, attachments by drag and drop, replies
quoted below your text, and a switch between Reply and Reply all. Addresses are suggested from
the people you write to most. Signatures (Settings › Signatures) go under your text, a default
per account for new messages and for replies, switchable in the message. Sending waits 10 seconds so you can undo it.

<img src="docs/screenshots/compose.png" alt="A compose window with address suggestions" width="600">

**Sort and group** the list from the View options: by date received (grouped into Today,
Yesterday, this week's days, last weeks and months), or by sender or recipient, A to Z, with
each person's messages together under their name.

**Search** as you type, over senders, recipients and subjects, in every folder or just the
current one. It understands `from:`, `to:`, `subject:`, `"exact phrases"` and `-exclusions`.

![Search results for "from:sarah roadmap"](docs/screenshots/search.png)

**Tags** work like Thunderbird's and sync with it: press `1`–`9` to tag, and see them as
coloured dots in the list. On Outlook and Microsoft 365 accounts they're Outlook categories,
so Outlook shows them too.

![The Tag menu on a tagged conversation](docs/screenshots/tags.png)

**Snooze** reminds you of a message later: pick a time, or a day on the calendar. The message
stays where it is and comes back to the top of your Inbox, unread, when it's due, on every
computer you use Email on.

**Everything from a sender** at a glance: Ctrl/⌘+2 opens a panel beside the message with all
the mail from whoever sent it, in every folder. Tick them all and delete or archive at once —
the quickest way to clear out a newsletter.

**Getting around:** fold the sidebar into a slim rail (Ctrl/⌘+1), or jump to any folder in any
account by typing its name (Ctrl/⌘+G).

![The sidebar as a rail, with all folders slid out](docs/screenshots/rail.png)
![The folder switcher](docs/screenshots/goto.png)

**Keyboard first.** Choose Gmail's or Thunderbird's shortcuts in Settings and change any of
them; press `?` to see them all. In a conversation, Enter moves onto its messages, ↑/↓ go
between them and Enter opens or closes one.

![Settings › Keyboard](docs/screenshots/keyboard.png)
![The keyboard shortcuts sheet](docs/screenshots/shortcuts.png)

**And also:** notifications for new mail, email links from your browser opening a new message
(Settings › General › Make Email the default), your own order and markers for accounts, and
images in messages blocked until you choose to load them. Pictures too wide for the reader
shrink to fit; click one to see it at its actual size. Marking mail as spam or not spam
also teaches your provider's spam filter.

## Good to know

- **Your mail stays on your computer.** Nothing goes anywhere but your mail servers. It's
  stored in `~/.local/share/dev.mailclient.desktop/` on Linux and
  `~/Library/Application Support/dev.mailclient.desktop/` on macOS.
- **Tags and Snooze on Outlook and Microsoft 365** go through Microsoft Graph, which needs
  your permission once: Settings › Accounts › Tags & snooze › Turn on…. A work or school
  account may need your administrator to allow it first.
- **Export and remove:** Settings › Accounts › Export… saves an account's mail as mbox files
  (one per folder) that other mail apps import, downloading any attachments first. Remove
  account… deletes what's on this computer; the mail on the server stays.
- **Something not working?** Settings › Troubleshooting shows the app's log.

## For developers

Building, testing and how it works inside: [docs/DEVELOPING.md](docs/DEVELOPING.md).
