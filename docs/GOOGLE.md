# Google: signing in, and Contacts

A Gmail or Google Workspace account can sign in on Google's page instead of with an app
password, and its contacts can sync two ways with the address book.

- **Contacts** need nothing from you in Email's released builds: they have an OAuth client of
  Email's own built in, for contacts only. **Connect…** opens Google's sign-in straight away.
  Your contacts go straight between Google and your computer, never through anyone else
  ([privacy policy](https://email.pehrsson.au/privacy)).
- **Signing in to Gmail** needs an OAuth client of your own for now: Google allows Gmail
  sign-in only through a client it has reviewed for mail, and Email's own client isn't one (it
  never asks for your mail). Making your own is free and takes about fifteen minutes. One client
  serves all your Google accounts, for mail and contacts.

Without a client, Gmail keeps working with an [app password](https://myaccount.google.com/apppasswords)
(it needs 2-Step Verification). Signing in with Google helps when app passwords aren't
available: a Workspace administrator turned them off, or the account uses Advanced Protection.

## Making the OAuth client

1. Open <https://console.cloud.google.com/projectcreate> and sign in (any of your Google
   accounts), and create a project, for instance "Mail client". (That page is more dependable
   than the console's "Select a project › New project", which sometimes returns to the home
   page without making one.)
2. For contacts: **APIs & Services › Library**: find **Google People API** and press **Enable**.
   (Mail needs no API turned on: Email reads it over IMAP.)
3. Open **APIs & Services › OAuth consent screen** (now called Google Auth Platform; directly:
   <https://console.cloud.google.com/auth/overview>), with the new project selected at the top.
   The first time, press **Get started**: an app name, your address as support email,
   **Audience: External**, your address as contact, then **Create**. Its pages (Branding,
   Audience, Data access, Clients) are then on the left.
4. **Audience**: press **Publish app**, so its status is **In production**. While it is in
   "Testing", Google ends the sign-in after 7 days. Unverified is fine for your own use: when you
   sign in, Google says once that it hasn't verified the app (Advanced › Go to …).
5. **Data access › Add or remove scopes**: add `https://mail.google.com/` (for mail) and
   `https://www.googleapis.com/auth/contacts` (for contacts). Google calls the mail one
   *restricted*; that only matters for an app offered to the public, not for your own.
6. **Clients › Create client**: type **Desktop app**. Copy the **client ID** and the
   **client secret**.

In Email, the first time a Google sign-in needs it, Email asks for the client ID and secret and
keeps them in the system keychain:
- **Adding an account:** type a Gmail or Workspace address, then **sign in with Google** under
  the app password field (once the client is there, Google sign-in is the default).
- **An account already on an app password:** Settings › Accounts › the account › Password ›
  **Sign in with Google instead…**. Its mail stays as it is; the app password is no longer used
  (you can revoke it in your Google account).
- **Contacts:** Settings › Accounts › the account › Google Contacts › **Connect…**. With Email's
  own client built in, it asks for nothing; while you have a client of your own set, new
  connections use yours.

On Google's page, Google first says it hasn't verified the app (**Advanced › Go to …**), then
lists what the app asks for. Tick **Read, compose, send, and permanently delete all your email
from Gmail**: Google may leave it unticked, and without it Email can't reach your mail.

Each account remembers the client it signed in with, so **Forget it** (under the accounts) stops
contacts connected with your client syncing (with Email's own client built in, connecting again
uses that) but leaves signed-in accounts working. If Google ends a sign-in (you revoked
it, or changed your password), the sidebar says **Sign-in needed**; **Fix…** signs in again.

**A Google Workspace account** (a company's) works with the same client unless its
administrator blocks apps they haven't approved, or IMAP. If signing in says "access blocked",
the admin can mark the client ID as trusted (Admin console › Security › API controls), or for
contacts with Email's own client, Email itself (Security › API controls › App access control).

**Until Google has verified Email's own client**, connecting contacts with it also says once
that Google hasn't verified the app: **Advanced › Go to Email (unsafe)** continues.

**Building it in:** a copy of Email you build yourself, or one from a fork, has no client built
in. Set `MAIL_GOOGLE_CLIENT_ID` and `MAIL_GOOGLE_CLIENT_SECRET` when building (as repository
secrets for the GitHub build, or in the environment or `scripts/mac-signing.env` for a local
one), and that build connects contacts without asking for a client. It's used for contacts only,
so its consent screen needs only the contacts scope.

## Google Contacts

The address book can sync two ways with a connected account's contacts (Settings › Accounts ›
the account › Google Contacts › **Connect…**).

- The first sync only reads: the account's contacts appear in the address book, marked with a
  small **G**. Contacts already in the address book stay as they were, on this computer.
- After that it syncs when the address book opens, shortly after you change one of its
  contacts, and every 15 minutes.
- Editing a contact here changes it in Google. Only the name, addresses, phone numbers, company
  and notes are changed; everything else (labels like "work" or "mobile", job titles, birthdays,
  photos) stays as it is. If it was changed in Google meanwhile, the other fields keep Google's
  version and yours go on top.
- A contact shows what else Google has for it: its photo, job title and department, nickname,
  the kind of each address and number ("Mobile", "Work"), postal addresses, birthday and other
  dates, websites, family and chat accounts. These are shown only; **Edit more in Google
  Contacts** opens the contact there to change them. The photo is fetched from Google the first
  time the contact is opened or their mail is listed, then kept on this computer.
- While the address book is open, the sidebar lists, in place of the folders: all contacts, each connected account's contacts
  and its groups (labels in Google Contacts: My Contacts, Starred, and your own, such as Family
  or Work), and those kept only on this computer, each with how many. A contact's groups are
  shown on its row (all but My Contacts). Groups are changed in Google; the next sync brings
  them here. A new contact goes to the account you're looking at.
- A contact's photo is also their sender picture beside their mail, in place of their company's
  logo.
- Deleting a contact here deletes it in Google (the question says so).
- A new contact goes to the place chosen under **Saved in** (this computer, or one of the
  connected Google accounts).
- **Disconnect** (or removing the account) takes its contacts out of the address book and
  changes nothing in Google.
- Only your contacts are synced, not Google's "Other contacts" (everyone you've written to).
  Contacts with only a phone number are left out.

## Trying the API by hand

```
GOOGLE_ACCESS_TOKEN=… cargo test -p mail-core gcontacts::tests::live -- --ignored --nocapture
```

reads the contacts list with an access token (from the OAuth Playground, say) and changes
nothing.
