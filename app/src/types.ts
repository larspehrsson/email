// Types mirror src/api-contract.md exactly. All JSON is camelCase, timestamps are unix seconds.

export type Provider = 'gmail' | 'outlook' | 'imap';

export interface Account {
  id: number;
  email: string;
  displayName: string;
  provider: Provider;
  /** how it signs in: a password (kept in the keychain) or Microsoft's sign-in page */
  auth: 'password' | 'microsoft';
  /** its server keeps keywords we make up (tags, snooze); null until the first sync tells */
  keywords: boolean | null;
  /** Microsoft: tags and snooze go through Microsoft Graph (the user allowed it) */
  graph: boolean;
  /** its marker's letter and colour (a palette name, lib/accountMarks) as the user set them;
   *  null: automatic */
  markLetter: string | null;
  markColor: string | null;
}

/** What exporting an account involves (its dialog). */
export interface ExportPlan {
  messages: number;
  /** not here whole (attachments left on the server, or not downloaded): fetched for it */
  toDownload: number;
  downloadBytes: number;
}
/** An export under way. */
export interface ExportStatus {
  accountId: number;
  done: number;
  total: number;
}
/** How an export ended. */
export interface ExportResult {
  accountId: number;
  /** the folder written (named "… (incomplete)" when stopped) */
  path: string | null;
  written: number;
  /** written without their attachments (couldn't be downloaded) */
  partial: number;
  /** not written (not here, couldn't be downloaded) */
  failed: number;
  cancelled: boolean;
  error: string | null;
}

/** Whether Email opens mailto: links on this system. */
export interface DefaultMail {
  supported: boolean;
  isDefault: boolean;
}

export type FolderRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'junk'
  | 'archive'
  | 'all'
  | 'flagged'
  | 'important'
  | null;

export interface Folder {
  id: number;
  accountId: number;
  path: string[];
  displayName: string;
  role: FolderRole;
  selectable: boolean;
  total: number;
  unread: number;
  syncedCount: number;
}

export interface MessageSummary {
  id: number;
  folderId: number;
  subject: string;
  fromName: string;
  fromAddr: string;
  date: number;
  snippet: string | null;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  hasBody: boolean;
  /** tag keywords, e.g. ["$label2"] (see TagDef) */
  tags: string[];
  /** replied to (\\Answered, from any client) */
  answered: boolean;
  /** forwarded (Thunderbird's $Forwarded keyword) */
  forwarded: boolean;
  /** our message, waiting to be sent (undo window, or retrying) */
  sending: boolean;
  /** our message, refused by the server: not sent */
  sendFailed: boolean;
  /** a draft being written here (open it in a compose window) */
  draftId: number | null;
  /** snoozed until then (a reminder still to go off), Unix seconds */
  snoozedUntil?: number | null;
  /** bytes (the whole message, as the server counts it) */
  size?: number;
  /** its recipients (To, then Cc): shown instead of the sender for mail of ours (Sent, Drafts) */
  to?: Addr[];
}

/** Updating itself (app/src-tauri/src/updater.rs). */
export interface UpdateStatus {
  /** this copy updates itself (installed from the GitHub releases) */
  supported: boolean;
  checking: boolean;
  /** the version downloaded, installed on restart */
  ready: string | null;
  /** when it last asked, Unix seconds */
  checked: number | null;
  /** why the last check or download failed */
  error: string | null;
}

export interface Addr {
  name: string | null;
  addr: string;
}

export interface Attachment {
  /** stable position in this message's attachment list (pass back to commands) */
  index: number;
  name: string;
  mime: string;
  /** bytes (estimate when not downloaded yet) */
  size: number;
  /** available locally; otherwise Open/Save fetch it from the server first */
  downloaded: boolean;
  /** false for executable/script types: Save only */
  openable: boolean;
}

export interface MessageDetail {
  id: number;
  subject: string;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  date: number;
  html: string | null;
  text: string | null;
  attachments: Attachment[];
  hasRemoteContent: boolean;
  /** The user chose "Load images" for this message before. */
  remoteAllowed: boolean;
  tags: string[];
}

/**
 * Which of a conversation's messages to show (list summaries and the reader alike):
 * messages in the current folder always; with 'all', also those in any other folder except
 * Trash/Spam; with includeTrash, also those in Trash/Spam.
 */
export type ConversationScope = 'folder' | 'all';

/** A folder list's order: newest first, or by sender / first recipient (A to Z, newest first
 *  within each). The list is grouped by the same thing. */
export type ListSort = 'received' | 'from' | 'to' | 'size';

/** What a folder's list shows: all of it, or only what passes every set condition. `keep`:
 *  shown regardless (the open message or conversation, so reading it doesn't take it away). */
export interface ListFilter {
  /** false: unread only; true: read only */
  read?: boolean | null;
  flagged?: boolean;
  attachments?: boolean;
  keep?: number | null;
}

/** A person in the address book (id 0: not saved yet). */
export interface Card {
  id: number;
  name: string;
  emails: string[];
  phones: string[];
  company: string;
  notes: string;
  /** a Google contact of this account (null: kept only here); for a new card, where to make it */
  google?: number | null;
  /** a Google contact's groups (`contactGroups/…`, see GoogleLink.groups); changed in Google */
  groups?: string[];
}

/** What AI apps (MCP clients) may do (Settings › AI apps). */
export interface McpSettings {
  enabled: boolean;
  drafts: boolean;
  organize: boolean;
  delete: boolean;
  send: boolean;
  /** allowed accounts; null: all */
  accounts: number[] | null;
}
export interface McpStatus {
  settings: McpSettings;
  /** the program an MCP client starts, with --mcp */
  command: string;
}
export interface McpConfirm {
  id: number;
  client: string;
  title: string;
  lines: string[];
  body: string | null;
  ok: string;
}
export interface McpActivity {
  client: string;
  tool: string;
  summary: string;
  ok: boolean;
  undoOp: number | null;
  undoSend: number | null;
}
export interface McpLogEntry {
  at: number;
  client: string;
  tool: string;
  summary: string;
  ok: boolean;
}

/** A group in Google Contacts ("label" there): My Contacts, Starred, or one of the user's. */
export interface ContactGroup {
  /** `contactGroups/…` */
  resource: string;
  name: string;
}
/** An account linked to its Google contacts. */
export interface GoogleLink {
  accountId: number;
  googleEmail: string;
  /** last good sync, Unix seconds */
  synced: number | null;
  error: string | null;
  count: number;
  /** its groups, in the order shown (My Contacts, Starred, then the user's own by name) */
  groups: ContactGroup[];
}
/** A value with Google's name for its kind ("Mobile", "Work"; may be empty). */
export interface Labeled {
  value: string;
  label: string;
}
/** A date as Google keeps it (a birthday may have no year). */
export interface ContactDay {
  year: number | null;
  month: number;
  day: number;
}
/** What Google has for a contact beyond what the address book edits (shown, edited there). */
export interface ContactDetails {
  /** data: URL */
  photo: string | null;
  title: string;
  department: string;
  nicknames: string[];
  emails: Labeled[];
  phones: Labeled[];
  addresses: Labeled[];
  birthday: ContactDay | null;
  /** [date, kind] */
  events: [ContactDay, string][];
  websites: Labeled[];
  relations: Labeled[];
  chat: Labeled[];
  /** The contact in Google Contacts. */
  link: string | null;
}
export interface GoogleStatus {
  /** the user's OAuth client (null: not set yet) */
  clientId: string | null;
  links: GoogleLink[];
}

/** Writing help (Claude, with the user's own API key). */
export type AiTask =
  | { kind: 'reply' }
  | { kind: 'compose' }
  | { kind: 'rewrite'; style: 'improve' | 'shorter' | 'longer' | 'formal' | 'friendly' | 'proofread' }
  | { kind: 'translate'; language: string }
  /** a question about a message (`original`: its source) */
  | { kind: 'ask'; question: string };
export interface AiRequest {
  /** "Name <addr>": who's writing */
  me: string;
  subject: string;
  to: string[];
  /** the message replied to or forwarded, as plain text */
  original: string | null;
  /** what's written so far, as plain text */
  draft: string;
  /** the user's own words: what to say, or how */
  instruction: string;
}
export interface AiOutcome {
  /** all of the text (the streamed pieces may still be on their way) */
  text: string;
  refused: boolean;
  truncated: boolean;
  model: string;
}
export interface AiStatus {
  configured: boolean;
  models: string[];
  defaultModel: string;
}

/** Messages from one sender (the sender pane), newest first, each in its folder. */
export interface SenderPage {
  accountId: number;
  name: string;
  addr: string;
  total: number;
  messages: MessageSummary[];
}

/** A signature: a named block put under what's written (above a reply's quote). */
export interface Signature {
  id: number;
  name: string;
  html: string;
}
/** An account's default signatures (null: none). */
export interface SignatureDefaults {
  accountId: number;
  newId: number | null;
  replyId: number | null;
}
export interface Signatures {
  signatures: Signature[];
  defaults: SignatureDefaults[];
}

/** A run of rows in a sorted list: a sender, a recipient, or (by date, label null) a period. */
export interface ListGroup {
  label: string | null;
  count: number;
}

/** Fields plain (unprefixed) quick-search terms look in; null/empty = all three. */
export type SearchField = 'sender' | 'recipients' | 'subject' | 'body';

/** One conversation as it appears in a folder. */
export interface ThreadSummary {
  /** thread id */
  id: number;
  folderId: number;
  /** subject of the first message in the thread */
  subject: string;
  /** sender display names (or addresses), most recent first, unique, max 4 */
  participants: string[];
  /** the newest one from someone else (ours when all are): the conversation's picture */
  fromAddr?: string;
  /** the newest message's recipients (To, then Cc): shown when all of it is ours */
  to?: Addr[];
  /** messages in the whole conversation (all folders) */
  messageCount: number;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  /** newest message of the thread in this folder */
  date: number;
  snippet: string | null;
  latestMessageId: number;
  /** tags on any selected message of the conversation */
  tags: string[];
  /** the newest message from someone else was replied to / forwarded */
  answered: boolean;
  forwarded: boolean;
  /** the newest message is ours, waiting to be sent / refused by the server */
  sending: boolean;
  sendFailed: boolean;
  /** the latest snooze time among its messages, Unix seconds */
  snoozedUntil?: number | null;
}

/** get_thread result: the selected messages plus how many the scope hid. */
export interface ThreadView {
  messages: MessageSummary[];
  /** hidden messages in other folders (not Trash/Spam) */
  hiddenOther: number;
  /** hidden messages only in Trash/Spam */
  hiddenTrash: number;
}

export interface ThreadPage {
  total: number;
  threads: ThreadSummary[];
}

export type SyncPhase = 'idle' | 'connecting' | 'folders' | 'headers' | 'bodies' | 'error' | 'auth' | 'limited' | 'offline';

export interface SyncStatus {
  accountId: number;
  phase: SyncPhase;
  folderId: number | null;
  done: number;
  total: number;
  message: string | null;
}

export interface AddAccountArgs {
  email: string;
  password: string;
  displayName?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
}

export interface MessagePage {
  total: number;
  messages: MessageSummary[];
}

export interface FoldersChangedPayload {
  accountId: number;
}
export interface MessagesChangedPayload {
  folderIds: number[];
}
export interface MessageReadyPayload {
  id: number;
}

/** A user action on messages (api-contract `Action`). */
export type Action =
  | { kind: 'archive' }
  | { kind: 'trash' }
  | { kind: 'deleteForever' }
  | { kind: 'move'; targetFolderId: number }
  | { kind: 'spam' }
  | { kind: 'notSpam' }
  | { kind: 'read' }
  | { kind: 'unread' }
  | { kind: 'flag' }
  | { kind: 'unflag' }
  | { kind: 'tag'; keyword: string; on: boolean }
  /** a reminder: at `until` (Unix seconds) back unread at the top of the Inbox; nothing moves now */
  | { kind: 'snooze'; until: number }
  /** cancel the reminder */
  | { kind: 'unsnooze' };
export type ActionKind = Action['kind'];

/** Tag definition. Tags are IMAP keywords on messages (Thunderbird-compatible: $label1..$label5).
 *  `defined: false` = a keyword seen on messages without a definition. */
export interface TagDef {
  keyword: string;
  name: string;
  color: string;
  position: number;
  defined: boolean;
}

/** A message to send, as the composer has it (see compose in lib/compose.ts). */
/** What the actions need about the messages behind several picked rows (`selection_info`). */
export interface SelectionInfo {
  /** the messages (a conversation's: those in the folder), newest first */
  ids: number[];
  anyUnread: boolean;
  allFlagged: boolean;
  tagSets: string[][];
  snoozedUntil: number | null;
  /** bytes, all together */
  size: number;
  /** each message's subject and size, as `ids` */
  subjects: string[];
  sizes: number[];
}

export interface SendRequest {
  /** whole messages to send along as .eml attachments (forwarding several at once) */
  forwardMessages?: number[];
  accountId: number;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  /** body HTML (editor output, plus any quoted original) */
  html: string;
  /** file paths */
  attachments: string[];
  /** message being replied to (threading; marked replied once sent) */
  replyingTo: number | null;
  /** message being forwarded (marked forwarded once sent) */
  forwarding: number | null;
  /** attachments of `forwarding` to send along (their index) */
  forwardAttachments: number[];
  /** the composer's own state, handed back by cancel_send to reopen it */
  draft: unknown;
  /** the draft this comes from: discarded once the message is queued */
  draftId: number | null;
  /** save_draft: show it in Drafts (false until the user has changed something) */
  listed?: boolean;
}

export type ReplyMode = 'reply' | 'replyAll' | 'forward';

/** An account with its servers, as Settings › Accounts shows it. */
export interface AccountDetails {
  id: number;
  email: string;
  displayName: string;
  provider: Provider;
  imapHost: string;
  imapPort: number;
  /** where mail is sent from (the account's own server, or the default for its IMAP server) */
  smtpHost: string | null;
  smtpPort: number | null;
  /** the SMTP server is derived from the IMAP server, not set for the account */
  smtpDefault: boolean;
  /** whole messages are downloaded, attachments included (offline use) */
  keepAttachments: boolean;
}

/** An account's messages with attachments (Settings › Accounts › Offline); sizes on the server. */
export interface AttachmentCounts {
  accountId: number;
  /** stored without their attachments: what keeping attachments (still) downloads */
  missing: number;
  missingBytes: number;
  /** stored with their attachments */
  kept: number;
  keptBytes: number;
}

/** How much of an account is stored here (Settings › Accounts). */
export interface AccountStorage {
  accountId: number;
  messages: number;
  /** their size on the server, as it reports it */
  serverBytes: number;
  /** bodies and fetched attachments stored here */
  localBytes: number;
}

/** A file chosen to attach (picker or drop). */
export interface FileInfo {
  path: string;
  name: string;
  size: number;
}

/** A reply / forward, prefilled by the core (recipients, subject, quoted original). */
export interface ReplyContext {
  accountId: number;
  to: Addr[];
  cc: Addr[];
  subject: string;
  /** HTML sent under the new text (Gmail-style quote or forward block) */
  quoteHtml: string;
  replyingTo: number | null;
  forwarding: number | null;
  /** forward: the original's attachments (sent along unless removed) */
  attachments: Attachment[];
}

/** queued: sent at `sendAt` (ms) unless taken back with cancel_send(id) */
export interface SendQueued {
  id: number;
  sendAt: number;
}

export interface SendEventPayload {
  accountId: number;
  id: number;
  /** why it failed (send-failed only) */
  message: string | null;
}

/** Where `next_unread` found the next unread item: its id and row index in the folder list. */
export interface NextUnread {
  id: number;
  index: number;
}

export interface ActionResult {
  /** null when nothing was queued (e.g. no-op, or read/star which apply at once) */
  opId: number | null;
  undoable: boolean;
}

export interface ActionFailedPayload {
  message: string;
}

/** A new-mail notification was clicked: show the message (or, for several, the folder). */
export interface OpenMessagePayload {
  folderId: number;
  id: number | null;
}

/** Native macOS menu bar commands. */
export type MenuActionId =
  | 'search'
  | 'toggle-threaded'
  | 'toggle-scope'
  | 'add-account'
  | 'shortcuts'
  | 'settings'
  | 'show-log'
  | 'new-message'
  | 'sort-received'
  | 'sort-from'
  | 'sort-to'
  | 'sort-size'
  | 'show-source'
  | 'sender-panel'
  | 'address-book';
export interface MenuActionPayload {
  id: MenuActionId;
}

export interface EventMap {
  'folders-changed': FoldersChangedPayload;
  'messages-changed': MessagesChangedPayload;
  'message-ready': MessageReadyPayload;
  'sync-status': SyncStatus;
  'menu-action': MenuActionPayload;
  'message-sent': SendEventPayload;
  'send-failed': SendEventPayload;
  'action-failed': ActionFailedPayload;
  'open-message': OpenMessagePayload;
  'export-progress': ExportStatus;
  'export-finished': ExportResult;
  /** closing (or, quit, quitting) with an export running: ask, then close_anyway */
  'confirm-close': { status: ExportStatus; quit: boolean };
  /** mailto: links came from another program: take them (take_mailto_links) */
  mailto: null;
  /** writing help: a piece of the text being written for request `requestId` */
  'ai-text': { requestId: number; text: string };
  /** an AI app asks before deleting or sending (answer with mcp_answer) */
  'mcp-confirm': McpConfirm;
  /** a question nobody answered in time (or answered elsewhere): drop it */
  'mcp-confirm-done': number;
  'mcp-activity': McpActivity;
}

export interface CommandMap {
  list_accounts: { args: undefined; ret: Account[] };
  add_account: { args: AddAccountArgs; ret: Account };
  detect_provider: { args: { email: string }; ret: Provider | null };
  add_microsoft_account: { args: { loginHint: string | null; displayName: string | null }; ret: Account };
  microsoft_sign_in_again: { args: { accountId: number }; ret: void };
  cancel_sign_in: { args: undefined; ret: void };
  list_folders: { args: { accountId: number }; ret: Folder[] };
  open_folder: { args: { folderId: number }; ret: void };
  list_messages: { args: { folderId: number; offset: number; limit: number; sort: ListSort; filter?: ListFilter }; ret: MessagePage };
  list_signatures: { args: undefined; ret: Signatures };
  list_cards: { args: undefined; ret: Card[] };
  save_card: { args: { card: Card }; ret: number };
  delete_card: { args: { id: number }; ret: void };
  ai_status: { args: undefined; ret: AiStatus };
  ai_set_key: { args: { key: string | null }; ret: void };
  ai_run: { args: { requestId: number; model: string; task: AiTask; request: AiRequest }; ret: AiOutcome };
  ai_cancel: { args: { requestId: number }; ret: void };
  sender_messages: {
    args: { messageId: number | null; accountId: number | null; addr: string | null; offset: number; limit: number };
    ret: SenderPage | null;
  };
  save_signature: { args: { id: number | null; name: string; html: string }; ret: number };
  delete_signature: { args: { id: number }; ret: void };
  set_signature_defaults: { args: { accountId: number; newId: number | null; replyId: number | null }; ret: void };
  list_groups: { args: { folderId: number; threaded: boolean; sort: ListSort; filter?: ListFilter; bounds: number[] }; ret: ListGroup[] };
  get_message: { args: { id: number; allowRemote: boolean }; ret: MessageDetail | null };
  search_messages: {
    args: {
      accountId: number;
      folderId: number | null;
      query: string;
      offset: number;
      limit: number;
      fields: SearchField[] | null;
    };
    ret: MessagePage;
  };
  list_threads: {
    args: { folderId: number; offset: number; limit: number; scope: ConversationScope; includeTrash: boolean; filter?: ListFilter };
    ret: ThreadPage;
  };
  get_thread: {
    args: { threadId: number; folderId: number; scope: ConversationScope; includeTrash: boolean };
    ret: ThreadView;
  };
  get_sync_status: { args: undefined; ret: SyncStatus[] };
  set_read: { args: { id: number; read: boolean }; ret: void };
  open_attachment: { args: { messageId: number; index: number }; ret: void };
  save_attachment: { args: { messageId: number; index: number }; ret: string };
  save_all_attachments: { args: { messageId: number }; ret: string[] };
  apply_action: { args: { action: Action; messageIds: number[]; folderId: number }; ret: ActionResult };
  undo_action: { args: { opId: number }; ret: void };
  mark_folder_read: { args: { folderId: number }; ret: number };
  list_item_ids: {
    args: { folderId: number; threaded: boolean; sort: ListSort; filter?: ListFilter; offset: number; limit: number };
    ret: number[];
  };
  selection_info: { args: { folderId: number; items: number[]; threaded: boolean }; ret: SelectionInfo };
  sender_folders: { args: { messageIds: number[] }; ret: { folderId: number; count: number }[] };
  sender_icon: { args: { addr: string }; ret: string | null };
  account_logos: { args: undefined; ret: { accountId: number; dataUrl: string }[] };
  google_status: { args: undefined; ret: GoogleStatus };
  contact_details: { args: { cardId: number }; ret: ContactDetails | null };
  message_source: { args: { id: number }; ret: string };
  mcp_status: { args: undefined; ret: McpStatus };
  set_mcp_settings: { args: { settings: McpSettings }; ret: void };
  mcp_log: { args: undefined; ret: McpLogEntry[] };
  mcp_answer: { args: { id: number; allow: boolean }; ret: void };
  set_google_client: { args: { id: string | null; secret: string | null }; ret: void };
  google_connect: { args: { accountId: number }; ret: string };
  google_disconnect: { args: { accountId: number }; ret: void };
  google_sync: { args: { accountId: number | null }; ret: boolean };
  set_account_logo: { args: { accountId: number; dataUrl: string | null }; ret: void };
  list_tags: { args: undefined; ret: TagDef[] };
  set_tag: { args: { keyword: string | null; name: string; color: string }; ret: string };
  delete_tag: { args: { keyword: string }; ret: void };
  app_version: { args: undefined; ret: string };
  update_status: { args: undefined; ret: UpdateStatus };
  check_for_update: { args: undefined; ret: UpdateStatus };
  install_update: { args: undefined; ret: void };
  reveal_path: { args: { path: string }; ret: void };
  index_of: { args: { folderId: number; id: number; threaded: boolean; sort: ListSort; filter?: ListFilter }; ret: number | null };
  locate_message: {
    args: { folderId: number; messageId: number; threaded: boolean; sort: ListSort; filter?: ListFilter };
    ret: { id: number; index: number } | null;
  };
  next_unread: {
    args: { folderId: number; after: number | null; threaded: boolean; back: boolean; sort: ListSort; filter?: ListFilter };
    ret: NextUnread | null;
  };
  show_log: { args: undefined; ret: void };
  send_message: { args: { request: SendRequest }; ret: SendQueued };
  cancel_send: { args: { id: number }; ret: unknown | null };
  reply_context: { args: { id: number; mode: ReplyMode }; ret: ReplyContext };
  save_draft: { args: { id: number | null; request: SendRequest }; ret: number };
  open_draft: { args: { id: number }; ret: unknown };
  delete_draft: { args: { id: number }; ret: void };
  open_compose: { args: { draftId: number }; ret: void };
  file_info: { args: { paths: string[] }; ret: FileInfo[] };
  suggest_addresses: { args: { query: string; limit: number | null }; ret: Addr[] };
  account_details: { args: undefined; ret: AccountDetails[] };
  show_data_dir: { args: undefined; ret: void };
  open_devtools: { args: undefined; ret: void };
  message_in_folder: { args: { id: number; folderId: number | null }; ret: boolean };
  set_allow_remote: { args: { id: number; allow: boolean }; ret: void };
  allow_remote_sender: { args: { id: number }; ret: string };
  remote_senders: { args: undefined; ret: string[] };
  set_remote_sender: { args: { addr: string; on: boolean }; ret: void };
  update_password: { args: { accountId: number; password: string }; ret: void };
  set_keep_attachments: { args: { accountId: number; keep: boolean }; ret: void };
  set_display_name: { args: { accountId: number; name: string }; ret: void };
  set_account_order: { args: { ids: number[] }; ret: void };
  take_mailto_links: { args: Record<string, never>; ret: string[] };
  enable_graph: { args: { accountId: number }; ret: void };
  disable_graph: { args: { accountId: number }; ret: void };
  forget_address: { args: { addr: string }; ret: void };
  export_plan: { args: { accountId: number }; ret: ExportPlan };
  export_account: { args: { accountId: number; dir: string }; ret: void };
  cancel_export: { args: Record<string, never>; ret: void };
  export_status: { args: Record<string, never>; ret: ExportStatus | null };
  remove_account: { args: { accountId: number }; ret: void };
  close_anyway: { args: { quit: boolean }; ret: void };
  default_mail_status: { args: Record<string, never>; ret: DefaultMail };
  make_default_mail: { args: Record<string, never>; ret: void };
  set_account_mark: { args: { accountId: number; letter: string | null; color: string | null }; ret: void };
  set_notifications: { args: { enabled: boolean; whileInUse: boolean }; ret: void };
  test_notification: { args: undefined; ret: void };
  account_storage: { args: undefined; ret: AccountStorage[] };
  attachment_counts: { args: undefined; ret: AttachmentCounts[] };
  ui_log: { args: { message: string }; ret: void };
  remove_attachments: { args: { accountId: number }; ret: { messages: number; freedBytes: number } };
}

export type CommandName = keyof CommandMap;
export type EventName = keyof EventMap;

/** The minimal surface both the Tauri bridge and the in-browser mock implement. */
export interface Backend {
  invoke<K extends CommandName>(cmd: K, args: CommandMap[K]['args']): Promise<CommandMap[K]['ret']>;
  listen<K extends EventName>(event: K, cb: (payload: EventMap[K]) => void): Promise<() => void>;
}
