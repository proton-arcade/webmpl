/**
 * The route table.
 *
 * One list, in the order it is matched: the specific patterns first, then the
 * ones with a name in them, then the filesystem/WebDAV wildcards, and the site
 * itself last. Keeping it here means the whole API can be read in one screen —
 * which is the only way anybody notices that two routes answer to the same
 * path.
 */
export const ROUTES = [
    /* ------------------------------- sessions ----------------------------- */
    ['GET', '/api/health', 'auth', 'health', { public: true }],
    ['POST', '/api/login', 'auth', 'login', { public: true }],
    ['POST', '/api/guest', 'auth', 'guest', { public: true }],
    ['POST', '/api/logout', 'auth', 'logout'],
    ['GET', '/api/whoami', 'auth', 'whoami'],
    ['GET', '/api/guests', 'auth', 'guestLog'],
    ['GET', '/api/sessions', 'auth', 'sessions'],
    ['GET', '/api/users', 'auth', 'users'],
    ['POST', '/api/users', 'auth', 'createUser'],
    ['POST', '/api/users/:username/remove', 'auth', 'removeUser'],
    ['POST', '/api/users/:username/password', 'auth', 'setPassword'],
    ['POST', '/api/users/:username/mailbox', 'auth', 'setMailbox'],
    ['GET', '/api/settings', 'auth', 'getSettings'],
    ['PUT', '/api/settings', 'auth', 'putSettings'],
    ['GET', '/api/installed', 'auth', 'installed'],
    ['POST', '/api/installed', 'auth', 'install'],
    ['DELETE', '/api/installed', 'auth', 'uninstall'],
    ['GET', '/api/stats', 'auth', 'stats'],
    ['GET', '/api/storage', 'auth', 'storage'],
    ['GET', '/api/logs', 'auth', 'logs'],

    /* ------------------------------ filesystem ---------------------------- */
    ['GET', '/api/fs/tree', 'fs', 'tree'],
    ['GET', '/api/fs/tree/:username', 'fs', 'treeOf'],
    ['POST', '/api/fs/ops', 'fs', 'ops'],
    ['GET', '/api/fs/users', 'fs', 'users'],
    ['GET', '/api/fs/stat', 'fs', 'stat'],
    ['GET', '/api/fs/readdir', 'fs', 'readdir'],
    ['GET', '/api/fs/read', 'fs', 'read'],
    ['POST', '/api/fs/write', 'fs', 'write'],
    ['PUT', '/api/fs/write', 'fs', 'write'],
    ['POST', '/api/fs/mkdir', 'fs', 'mkdir'],
    ['POST', '/api/fs/remove', 'fs', 'remove'],
    ['DELETE', '/api/fs/remove', 'fs', 'remove'],
    ['POST', '/api/fs/move', 'fs', 'move'],
    ['POST', '/api/fs/copy', 'fs', 'copy'],
    ['POST', '/api/fs/trash', 'fs', 'trash'],
    ['POST', '/api/fs/empty-trash', 'fs', 'emptyTrash'],
    ['GET', '/api/fs/search', 'fs', 'search'],
    ['GET', '/api/fs/usage', 'fs', 'usage'],
    ['POST', '/api/fs/upload', 'fs', 'upload'],
    ['PUT', '/api/fs/file', 'fs', 'putFile'],
    ['GET', '/api/fs/shares', 'fs', 'shares'],
    ['POST', '/api/fs/share', 'fs', 'share'],
    ['DELETE', '/api/fs/share/:token', 'fs', 'unshare'],
    ['GET', '/api/fs/raw/*rest', 'fs', 'raw'],

    /* -------------------------------- events ------------------------------ */
    ['GET', '/api/events', 'fs', 'stream'],
    ['GET', '/api/events/recent', 'fs', 'recent'],

    /* ------------------------------- applications -------------------------- */
    ['GET', '/api/apps', 'apps', 'list'],
    ['POST', '/api/apps', 'apps', 'publish'],
    ['GET', '/api/apps/pending', 'apps', 'pending'],
    ['GET', '/api/apps/:id/code', 'apps', 'code'],
    ['POST', '/api/apps/:id/approve', 'apps', 'approve'],
    ['POST', '/api/apps/:id/reject', 'apps', 'reject'],
    ['POST', '/api/apps/:id/install', 'apps', 'install'],
    ['POST', '/api/apps/:id/uninstall', 'apps', 'uninstall'],
    ['DELETE', '/api/apps/:id', 'apps', 'remove'],

    /* ---------------------------------- mail ------------------------------ */
    ['GET', '/api/mail', 'mail', 'list'],
    ['GET', '/api/mail/address', 'mail', 'address'],
    ['GET', '/api/mail/unread', 'mail', 'unread'],
    ['GET', '/api/mail/mailboxes', 'mail', 'mailboxes'],
    ['POST', '/api/mail/send', 'mail', 'send'],
    ['POST', '/api/mail/empty', 'mail', 'empty'],
    ['PATCH', '/api/mail/:id', 'mail', 'update'],
    ['DELETE', '/api/mail/:id', 'mail', 'remove'],

    /* -------------------------------- terminal ----------------------------- */
    ['POST', '/api/term', 'terminal', 'run'],
    ['GET', '/api/term/complete', 'terminal', 'complete'],
    ['GET', '/api/term/prompt', 'terminal', 'prompt'],
    ['POST', '/api/term/close', 'terminal', 'close'],

    /* --------------------------------- system ----------------------------- */
    ['GET', '/api/system/info', 'system', 'info', { public: true }],
    ['GET', '/api/system/airgap', 'system', 'airgap'],
    ['GET', '/api/system/banner', 'system', 'banner', { public: true }],
    ['GET', '/api/system/storage', 'system', 'storage'],
    ['GET', '/api/system/log', 'system', 'logs'],
    ['GET', '/api/system/capabilities', 'system', 'capabilities', { public: true }],

    /* -------------------------------- hosting ------------------------------ */
    ['GET', '/api/hosting', 'hosting', 'list'],
    ['POST', '/api/hosting', 'hosting', 'publish'],
    ['DELETE', '/api/hosting/:name', 'hosting', 'unpublish'],
    ['GET', '/site/*rest', 'hosting', 'serve', { public: true }],

    /* -------------------------------- drivers ------------------------------ */
    ['GET', '/api/drivers', 'drivers', 'list'],
    ['POST', '/api/drivers/call/:interface/:method', 'drivers', 'call'],

    /* --------------------------------- webdav ----------------------------- */
    ['OPTIONS', '/webdav/*rest', 'webdav', 'options'],
    ['PROPFIND', '/webdav/*rest', 'webdav', 'propfind'],
    ['GET', '/webdav/*rest', 'webdav', 'get'],
    ['HEAD', '/webdav/*rest', 'webdav', 'head'],
    ['PUT', '/webdav/*rest', 'webdav', 'put'],
    ['DELETE', '/webdav/*rest', 'webdav', 'delete'],
    ['MKCOL', '/webdav/*rest', 'webdav', 'mkcol'],
    ['MOVE', '/webdav/*rest', 'webdav', 'move'],
    ['COPY', '/webdav/*rest', 'webdav', 'copy'],

    /* --------------------------------- the site --------------------------- */
    ['GET', '/', 'static', 'index', { public: true }],
    ['HEAD', '/', 'static', 'head', { public: true }],
    ['GET', '/*rest', 'static', 'file', { public: true }],
    ['HEAD', '/*rest', 'static', 'head', { public: true }],
];
