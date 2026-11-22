# Google Contacts

The address book can sync two ways with the contacts of a Gmail or Google Workspace account
(Settings › Accounts › Google Contacts › Connect). Google only lets an app at your contacts
through an OAuth client, and a desktop app can't ship one that works for everybody, so you make
your own once. It is free and takes about five minutes. One client serves all your Google
accounts.

## Making the OAuth client

1. Open <https://console.cloud.google.com/> and sign in (any of your Google accounts). Create a
   project, for instance "Mail client".
2. **APIs & Services › Library**: find **Google People API** and press **Enable**.
3. **Google Auth Platform › Branding** (the "OAuth consent screen" in older consoles): an app
   name, your address as support and developer contact. **Audience: External.**
4. **Audience**: press **Publish app**, so its status is **In production**. While it is in
   "Testing", Google ends the sign-in after 7 days. Unverified is fine for your own use: when you
   sign in, Google says once that it hasn't verified the app (Advanced › Go to …).
5. **Data access › Add or remove scopes**: add `https://www.googleapis.com/auth/contacts`.
6. **Clients › Create client**: type **Desktop app**. Copy the **client ID** and the
   **client secret**.

In Email: Settings › Accounts, at a Gmail account, **Connect Google Contacts…**. The first time
it asks for the client ID and secret (kept in the macOS keychain), then opens Google's sign-in in
your browser.

**A Google Workspace account** (a company's) works with the same client unless its
administrator blocks apps they haven't approved. If signing in says "access blocked", the admin
can mark the client ID as trusted (Admin console › Security › API controls).

## What it does

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
