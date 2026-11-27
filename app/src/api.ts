import type {
  Account,
  Action,
  AccountDetails,
  AccountStorage,
  AttachmentCounts,
  ActionResult,
  Addr,
  UpdateStatus,
  FileInfo,
  NextUnread,
  Provider,
  ReplyContext,
  ReplyMode,
  SendQueued,
  SendRequest,
  AddAccountArgs,
  Backend,
  CommandMap,
  CommandName,
  ConversationScope,
  ListGroup,
  ListSort,
  ListFilter,
  SelectionInfo,
  GoogleStatus,
  ContactDetails,
  McpStatus,
  McpSettings,
  McpLogEntry,
  SearchField,
  Signatures,
  SenderPage,
  Card,
  AiOutcome,
  AiRequest,
  AiStatus,
  AiTask,
  EventMap,
  EventName,
  Folder,
  MessageDetail,
  MessagePage,
  SyncStatus,
  ThreadPage,
  ThreadView,
  TagDef,
  DefaultMail,
  ExportPlan,
  ExportStatus,
} from './types';

export * from './types';

export const isTauri: boolean = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The app's own address for a message's plain-`http://` picture (`mailimg:`, fetched by the
 *  core; see `rescueHttpImages`); null outside the app. */
export function mailImageUrl(url: string): string | null {
  if (!isTauri) return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc(path: string, protocol: string): string } }).__TAURI_INTERNALS__;
  return internals.convertFileSrc(url, 'mailimg');
}

async function createTauriBackend(): Promise<Backend> {
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  return {
    invoke(cmd, args) {
      return invoke(cmd, (args ?? {}) as Record<string, unknown>);
    },
    async listen(event, cb) {
      return listen(event, (e) => cb(e.payload as never));
    },
  };
}

const backendPromise: Promise<Backend> = isTauri
  ? createTauriBackend()
  : import('./mock').then((m) => m.createMockBackend());

async function call<K extends CommandName>(
  cmd: K,
  args: CommandMap[K]['args'],
): Promise<CommandMap[K]['ret']> {
  const b = await backendPromise;
  return b.invoke(cmd, args);
}

/** Normalise anything thrown across the bridge into a readable string. */
export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}

export const api = {
  listAccounts: (): Promise<Account[]> => call('list_accounts', undefined),
  /** Whose mail service an address is on (known domains, else its MX records); null: unknown. */
  detectProvider: (email: string): Promise<Provider | null> => call('detect_provider', { email }),
  /** Add a Microsoft account by signing in in the browser (resolves once that's done). */
  addMicrosoftAccount: (loginHint: string | null, displayName: string | null): Promise<Account> =>
    call('add_microsoft_account', { loginHint, displayName }),
  /** Sign a Microsoft account in again (its sign-in expired or was revoked). */
  microsoftSignInAgain: (accountId: number): Promise<void> => call('microsoft_sign_in_again', { accountId }),
  /** Add a Gmail or Workspace account by signing in with Google in the browser (the Google
   *  client in Settings). */
  addGoogleAccount: (loginHint: string | null, displayName: string | null): Promise<Account> =>
    call('add_google_account', { loginHint, displayName }),
  /** Sign a Gmail account in with Google: again, or instead of its app password. */
  googleSignIn: (accountId: number): Promise<void> => call('google_sign_in', { accountId }),
  /** Stop waiting for a browser sign-in (the pending call fails with "Sign-in cancelled."). */
  cancelSignIn: (): Promise<void> => call('cancel_sign_in', undefined),
  addAccount: (a: AddAccountArgs): Promise<Account> =>
    call('add_account', {
      email: a.email,
      password: a.password,
      // Explicit nulls so Rust `Option<T>` params always receive a key.
      displayName: a.displayName || null,
      imapHost: a.imapHost || null,
      imapPort: a.imapPort ?? null,
    }),
  listFolders: (accountId: number): Promise<Folder[]> => call('list_folders', { accountId }),
  openFolder: (folderId: number): Promise<void> => call('open_folder', { folderId }),
  /** Mark every message in the folder read; how many were unread. */
  markFolderRead: (folderId: number): Promise<number> => call('mark_folder_read', { folderId }),
  /** The list's row ids from `offset` in its order (⇧-click ranges, Select All). */
  listItemIds: (folderId: number, threaded: boolean, sort: ListSort, filter: ListFilter | undefined, offset: number, limit: number): Promise<number[]> =>
    call('list_item_ids', { folderId, threaded, sort, filter, offset, limit }),
  accountLogos: (): Promise<{ accountId: number; dataUrl: string }[]> => call('account_logos', undefined),
  googleStatus: (): Promise<GoogleStatus> => call('google_status', undefined),
  mcpStatus: (): Promise<McpStatus> => call('mcp_status', undefined),
  setMcpSettings: (settings: McpSettings): Promise<void> => call('set_mcp_settings', { settings }),
  mcpLog: (): Promise<McpLogEntry[]> => call('mcp_log', undefined),
  mcpAnswer: (id: number, allow: boolean): Promise<void> => call('mcp_answer', { id, allow }),
  /** A message's whole source as text. */
  messageSource: (id: number): Promise<string> => call('message_source', { id }),
  setGoogleClient: (id: string | null, secret: string | null): Promise<void> => call('set_google_client', { id, secret }),
  /** Browser sign-in, then a first sync; the Google address signed in with. */
  googleConnect: (accountId: number): Promise<string> => call('google_connect', { accountId }),
  googleDisconnect: (accountId: number): Promise<void> => call('google_disconnect', { accountId }),
  /** Sync one account's Google contacts (null: all); whether anything changed here. */
  googleSync: (accountId: number | null): Promise<boolean> => call('google_sync', { accountId }),
  /** A Google contact's photo, title, addresses, birthday…; null for one kept only here. */
  contactDetails: (cardId: number): Promise<ContactDetails | null> => call('contact_details', { cardId }),
  setAccountLogo: (accountId: number, dataUrl: string | null): Promise<void> => call('set_account_logo', { accountId, dataUrl }),
  /** A sender's picture (data: URL) from their domain; null when there's none. */
  /** `scope`: whose pictures may be looked up (Settings › General › Sender pictures). */
  senderIcon: (addr: string, scope: 'contacts' | 'known' | 'all'): Promise<string | null> => call('sender_icon', { addr, scope }),
  /** Where these messages' senders' mail is kept, most first (the Move list's order). */
  senderFolders: (messageIds: number[]): Promise<{ folderId: number; count: number }[]> => call('sender_folders', { messageIds }),
  /** The messages behind several picked rows, with their state. */
  selectionInfo: (folderId: number, items: number[], threaded: boolean): Promise<SelectionInfo> =>
    call('selection_info', { folderId, items, threaded }),
  listMessages: (folderId: number, offset: number, limit: number, sort: ListSort = 'received', filter?: ListFilter): Promise<MessagePage> =>
    call('list_messages', { folderId, offset, limit, sort, filter }),
  /** The groups the folder's list shows, in its order (counts add up to its rows). By date,
   *  `bounds` (Unix seconds, newest first) cut it into periods: one count per period and one
   *  for what's older than all of them. */
  listGroups: (folderId: number, threaded: boolean, sort: ListSort, bounds: number[], filter?: ListFilter): Promise<ListGroup[]> =>
    call('list_groups', { folderId, threaded, sort, filter, bounds }),
  getMessage: (id: number, allowRemote: boolean): Promise<MessageDetail | null> =>
    call('get_message', { id, allowRemote }),
  /** Quick search; `folderId: null` searches the whole account. Newest first. */
  searchMessages: (
    accountId: number,
    folderId: number | null,
    query: string,
    offset: number,
    limit: number,
    /** null = all fields */
    fields: SearchField[] | null,
  ): Promise<MessagePage> => call('search_messages', { accountId, folderId, query, offset, limit, fields }),
  /** Where a message is among a search's results; null if it isn't one. */
  searchIndexOf: (accountId: number, folderId: number | null, query: string, fields: SearchField[] | null, id: number): Promise<number | null> =>
    call('search_index_of', { accountId, folderId, query, fields, id }),
  listThreads: (
    folderId: number,
    offset: number,
    limit: number,
    scope: ConversationScope,
    includeTrash: boolean,
    filter?: ListFilter,
  ): Promise<ThreadPage> => call('list_threads', { folderId, offset, limit, scope, includeTrash, filter }),
  /** Every message in the conversation, all folders, oldest first. */
  getThread: (
    threadId: number,
    folderId: number,
    scope: ConversationScope,
    includeTrash: boolean,
  ): Promise<ThreadView> => call('get_thread', { threadId, folderId, scope, includeTrash }),
  getSyncStatus: (): Promise<SyncStatus[]> => call('get_sync_status', undefined),
  /** Check every account for new mail now (the refresh button, F5). */
  checkNow: (): Promise<void> => call('check_now', undefined),
  /** Is message `id` still in `folderId` (null = still exists at all)? */
  /** Row index of a message / conversation in the folder's list (null = not in it). */
  indexOf: (folderId: number, id: number, threaded: boolean, sort: ListSort = 'received', filter?: ListFilter): Promise<number | null> =>
    call('index_of', { folderId, id, threaded, sort, filter }),
  /** Where a message shows in the folder's list: its row's id (the message, or its conversation) and position. */
  locateMessage: (
    folderId: number,
    messageId: number,
    threaded: boolean,
    sort: ListSort = 'received',
    filter?: ListFilter,
  ): Promise<{ id: number; index: number } | null> => call('locate_message', { folderId, messageId, threaded, sort, filter }),
  /** The next unread item below `after` in the folder's list, wrapping to the top; with `back`
   *  the previous one above it, wrapping to the bottom (null = none). */
  nextUnread: (
    folderId: number,
    after: number | null,
    threaded: boolean,
    back = false,
    sort: ListSort = 'received',
    filter?: ListFilter,
  ): Promise<NextUnread | null> => call('next_unread', { folderId, after, threaded, back, sort, filter }),
  /** Queue a message; it goes out after the undo window unless cancelSend(id) takes it back. */
  sendMessage: (request: SendRequest): Promise<SendQueued> => call('send_message', { request }),
  /** Save the composer's state as draft `id` (new when null); shown in Drafts. Returns its id. */
  saveDraft: (id: number | null, request: SendRequest): Promise<number> => call('save_draft', { id, request }),
  openDraft: (id: number): Promise<unknown> => call('open_draft', { id }),
  deleteDraft: (id: number): Promise<void> => call('delete_draft', { id }),
  accountDetails: (): Promise<AccountDetails[]> => call('account_details', undefined),
  /** Reveal the app's data folder (mail.db, bodies.db). */
  showDataDir: (): Promise<void> => call('show_data_dir', undefined),
  /** The web inspector for this window. */
  openDevtools: (): Promise<void> => call('open_devtools', undefined),
  /** People matching what's typed in To/Cc/Bcc, best first (from the mail you've exchanged). */
  suggestAddresses: (query: string, limit: number | null = null): Promise<Addr[]> => call('suggest_addresses', { query, limit }),
  /** Name and size of files to attach (missing files and folders are left out). */
  fileInfo: (paths: string[]): Promise<FileInfo[]> => call('file_info', { paths }),
  /** A server draft's attachments as files of their own (for the draft opened from it). */
  draftAttachmentFiles: (messageId: number): Promise<string[]> => call('draft_attachment_files', { messageId }),
  /** Open (or focus) the compose window of draft `draftId` (at the last compose window's size). */
  openCompose: (draftId: number): Promise<void> => call('open_compose', { draftId }),
  /** Prefill a reply / reply-all / forward of a message (downloads it first if needed). */
  replyContext: (id: number, mode: ReplyMode): Promise<ReplyContext> => call('reply_context', { id, mode }),
  /** Take back a queued (or failed) message: its draft, to reopen the composer. */
  cancelSend: (id: number): Promise<unknown | null> => call('cancel_send', { id }),
  /** Reveal the app's log file in the file manager. */
  showLog: (): Promise<void> => call('show_log', undefined),
  messageInFolder: (id: number, folderId: number | null): Promise<boolean> =>
    call('message_in_folder', { id, folderId }),
  openAttachment: (messageId: number, index: number): Promise<void> =>
    call('open_attachment', { messageId, index }),
  /** Returns the absolute path written in Downloads. */
  saveAttachment: (messageId: number, index: number): Promise<string> =>
    call('save_attachment', { messageId, index }),
  /** Saves every attachment into a new Downloads folder; returns its path. */
  saveAllAttachments: (messageId: number): Promise<string[]> => call('save_all_attachments', { messageId }),
  /** Save As…: the system's save dialog; the path written, or null if cancelled. */
  /** Whether the app starts when the user logs in (Settings › General). */
  startAtLogin: (): Promise<boolean> => call('start_at_login', undefined),
  setStartAtLogin: (on: boolean): Promise<void> => call('set_start_at_login', { on }),
  saveAttachmentAs: (messageId: number, index: number): Promise<string | null> =>
    call('save_attachment_as', { messageId, index }),
  /** Applies locally at once; moves reach the server after a 5 s undo window. */
  applyAction: (action: Action, messageIds: number[], folderId: number): Promise<ActionResult> =>
    call('apply_action', { action, messageIds, folderId }),
  undoAction: (opId: number): Promise<void> => call('undo_action', { opId }),
  listTags: (): Promise<TagDef[]> => call('list_tags', undefined),
  /** Create (keyword null) or rename/recolour; returns the keyword. */
  setTag: (keyword: string | null, name: string, color: string): Promise<string> => call('set_tag', { keyword, name, color }),
  deleteTag: (keyword: string): Promise<void> => call('delete_tag', { keyword }),
  listSignatures: (): Promise<Signatures> => call('list_signatures', undefined),
  /** The address book, by name. */
  listCards: (): Promise<Card[]> => call('list_cards', undefined),
  /** Save a contact (new when its id is 0); returns its id. */
  saveCard: (card: Card): Promise<number> => call('save_card', { card }),
  deleteCard: (id: number): Promise<void> => call('delete_card', { id }),
  aiStatus: (): Promise<AiStatus> => call('ai_status', undefined),
  /** Keep the Anthropic API key in the keychain (null: forget it). */
  aiSetKey: (key: string | null): Promise<void> => call('ai_set_key', { key }),
  /** Run a writing task; its text comes as `ai-text` events for `requestId` as it's written. */
  aiRun: (requestId: number, model: string, task: AiTask, request: AiRequest): Promise<AiOutcome> =>
    call('ai_run', { requestId, model, task, request }),
  aiCancel: (requestId: number): Promise<void> => call('ai_cancel', { requestId }),
  /** Everything from a sender, newest first: the sender of `messageId` (for our own message,
   *  whom it's with), or `addr` in `accountId`. Leaves out what's only in Trash or Spam. */
  senderMessages: (
    from: { messageId: number } | { accountId: number; addr: string },
    offset: number,
    limit: number,
  ): Promise<SenderPage | null> =>
    call('sender_messages', {
      messageId: 'messageId' in from ? from.messageId : null,
      accountId: 'accountId' in from ? from.accountId : null,
      addr: 'addr' in from ? from.addr : null,
      offset,
      limit,
    }),
  /** Create (id null) or change a signature; returns its id. */
  saveSignature: (id: number | null, name: string, html: string): Promise<number> => call('save_signature', { id, name, html }),
  deleteSignature: (id: number): Promise<void> => call('delete_signature', { id }),
  /** An account's default signatures: for new messages, and for replies and forwards. */
  setSignatureDefaults: (accountId: number, newId: number | null, replyId: number | null): Promise<void> =>
    call('set_signature_defaults', { accountId, newId, replyId }),
  appVersion: (): Promise<string> => call('app_version', undefined),
  /** Whether this copy updates itself, and where that stands (see lib/updates.ts). */
  updateStatus: (): Promise<UpdateStatus> => call('update_status', undefined),
  /** Ask for a newer version and download it; the status after. */
  checkForUpdate: (): Promise<UpdateStatus> => call('check_for_update', undefined),
  /** Install the downloaded version and restart (doesn't return when it works). */
  installUpdate: (): Promise<void> => call('install_update', undefined),
  revealPath: (path: string): Promise<void> => call('reveal_path', { path }),
  setRead: (id: number, read: boolean): Promise<void> => call('set_read', { id, read }),
  setAllowRemote: (id: number, allow: boolean): Promise<void> => call('set_allow_remote', { id, allow }),
  /** Always load images in mail from this message's sender; the address. */
  allowRemoteSender: (id: number): Promise<string> => call('allow_remote_sender', { id }),
  /** Always load images in mail from everyone at the sender's domain; returns "@domain". */
  allowRemoteDomain: (id: number): Promise<string> => call('allow_remote_domain', { id }),
  /** Whether "Always load…" can cover everyone at a domain (Settings › General › Privacy). */
  domainRules: (): Promise<boolean> => call('domain_rules', undefined),
  setDomainRules: (on: boolean): Promise<void> => call('set_domain_rules', { on }),
  /** Whether a picture that only loads over plain http may be fetched that way. */
  httpPictures: (): Promise<boolean> => call('http_pictures', undefined),
  setHttpPictures: (on: boolean): Promise<void> => call('set_http_pictures', { on }),
  /** Senders whose images always load. */
  remoteSenders: (): Promise<string[]> => call('remote_senders', undefined),
  setRemoteSender: (addr: string, on: boolean): Promise<void> => call('set_remote_sender', { addr, on }),
  updatePassword: (accountId: number, password: string): Promise<void> =>
    call('update_password', { accountId, password }),
  /** Remove an account's stored attachments (fetched again when opened); can take a minute. */
  removeAttachments: (accountId: number): Promise<{ messages: number; freedBytes: number }> =>
    call('remove_attachments', { accountId }),
  /** A line for the app log (slow screen updates and the like). */
  uiLog: (message: string): Promise<void> => call('ui_log', { message }),
  /** Per account, messages with attachments still to download and already stored. */
  attachmentCounts: (): Promise<AttachmentCounts[]> => call('attachment_counts', undefined),
  /** Messages and space used per account (can take a few seconds). */
  accountStorage: (): Promise<AccountStorage[]> => call('account_storage', undefined),
  /** Download whole messages for the account (attachments for offline use), or stop. */
  setKeepAttachments: (accountId: number, keep: boolean): Promise<void> =>
    call('set_keep_attachments', { accountId, keep }),
  /** The name mail from the account is sent under (empty: the address alone). */
  setDisplayName: (accountId: number, name: string): Promise<void> => call('set_display_name', { accountId, name }),
  defaultMailStatus: (): Promise<DefaultMail> => call('default_mail_status', {}),
  /** Make Email the program mailto: links open. */
  makeDefaultMail: (): Promise<void> => call('make_default_mail', {}),
  /** What exporting an account involves (how much must be downloaded). */
  exportPlan: (accountId: number): Promise<ExportPlan> => call('export_plan', { accountId }),
  /** Start exporting into a new folder in `dir`: runs on, with export-progress / export-finished. */
  exportAccount: (accountId: number, dir: string): Promise<void> => call('export_account', { accountId, dir }),
  cancelExport: (): Promise<void> => call('cancel_export', {}),
  exportStatus: (): Promise<ExportStatus | null> => call('export_status', {}),
  /** Stop the export and close the window (or quit) after all. */
  closeAnyway: (quit: boolean): Promise<void> => call('close_anyway', { quit }),
  /** Remove an account from this computer (nothing changes on the server). */
  removeAccount: (accountId: number): Promise<void> => call('remove_account', { accountId }),
  /** Leave an address out of the suggestions from now on. */
  forgetAddress: (addr: string): Promise<void> => call('forget_address', { addr }),
  /** Microsoft accounts: tags and snooze through Microsoft Graph (a browser sign-in). */
  enableGraph: (accountId: number): Promise<void> => call('enable_graph', { accountId }),
  disableGraph: (accountId: number): Promise<void> => call('disable_graph', { accountId }),
  /** mailto: links from other programs not yet taken (each opens a new message). */
  takeMailtoLinks: (): Promise<string[]> => call('take_mailto_links', {}),
  /** The order accounts are listed in, first to last. */
  setAccountOrder: (ids: number[]): Promise<void> => call('set_account_order', { ids }),
  /** An account's marker letter and colour; null for automatic. */
  setAccountMark: (accountId: number, letter: string | null, color: string | null): Promise<void> =>
    call('set_account_mark', { accountId, letter, color }),
  /** Desktop notifications for new mail in an Inbox (while the window isn't in use). */
  setNotifications: (enabled: boolean, whileInUse: boolean, details: boolean): Promise<void> =>
    call('set_notifications', { enabled, whileInUse, details }),
  /** Show a notification now, whatever the window: to see that they come through. */
  testNotification: (): Promise<void> => call('test_notification', undefined),
};

async function on<K extends EventName>(event: K, cb: (p: EventMap[K]) => void): Promise<() => void> {
  const b = await backendPromise;
  return b.listen(event, cb);
}

export const events = {
  onFoldersChanged: (cb: (p: EventMap['folders-changed']) => void) => on('folders-changed', cb),
  onMessagesChanged: (cb: (p: EventMap['messages-changed']) => void) => on('messages-changed', cb),
  onMessageReady: (cb: (p: EventMap['message-ready']) => void) => on('message-ready', cb),
  onSyncStatus: (cb: (p: EventMap['sync-status']) => void) => on('sync-status', cb),
  onMessageSent: (cb: (p: EventMap['message-sent']) => void) => on('message-sent', cb),
  onSendFailed: (cb: (p: EventMap['send-failed']) => void) => on('send-failed', cb),
  onActionFailed: (cb: (p: EventMap['action-failed']) => void) => on('action-failed', cb),
  onOpenMessage: (cb: (p: EventMap['open-message']) => void) => on('open-message', cb),
  onMenuAction: (cb: (p: EventMap['menu-action']) => void) => on('menu-action', cb),
  onMailto: (cb: () => void) => on('mailto', cb),
  onExportProgress: (cb: (p: EventMap['export-progress']) => void) => on('export-progress', cb),
  onExportFinished: (cb: (p: EventMap['export-finished']) => void) => on('export-finished', cb),
  onConfirmClose: (cb: (p: EventMap['confirm-close']) => void) => on('confirm-close', cb),
  onAiText: (cb: (p: EventMap['ai-text']) => void) => on('ai-text', cb),
  onMcpConfirm: (cb: (p: EventMap['mcp-confirm']) => void) => on('mcp-confirm', cb),
  onMcpConfirmDone: (cb: (p: EventMap['mcp-confirm-done']) => void) => on('mcp-confirm-done', cb),
  onMcpActivity: (cb: (p: EventMap['mcp-activity']) => void) => on('mcp-activity', cb),
};
