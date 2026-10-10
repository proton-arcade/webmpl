/**
 * Terminal sessions.
 *
 * One shell per session, and it lives here on the server rather than in the
 * browser — which is what makes the terminal a place rather than a decoration.
 * The working directory, the environment and the command history belong to the
 * account, so closing the tab and signing in from another machine on the
 * network leaves `cd -` knowing where you were.
 *
 * For a standard account the shell is a jail: every filesystem call it makes
 * goes through the filesystem service as that actor, so there is no path out of
 * their own home and no way to touch the server or anybody else's files. The
 * administrator is the exception, by design, and the only session that can be
 * given a shell on the host itself.
 */
import { BaseService } from '../lib/container.js';
import { Shell } from './shell.js';

export class TerminalService extends BaseService {
    static SERVICE_NAME = 'terminal';
    static DEPENDENCIES = ['fs', 'auth'];

    async _init () {
        this.fs = this.services.get('fs');
        this.shells = new Map();
    }

    shellFor (actor) {
        const key = actor.sessionId || actor.token;
        let shell = this.shells.get(key);
        if (!shell) {
            shell = new Shell({
                fs: this.fs,
                actor,
                services: this.services,
                config: this.config,
                log: this.log,
            });
            this.shells.set(key, shell);
        }
        shell.actor = actor;
        return shell;
    }

    /** Run one command line for a session. */
    async run (actor, line, { stdin = null } = {}) {
        if (!line && !stdin) {
            return { out: '', err: '', effects: [], cwd: this.fs.home(actor), rev: this.fs.rev(actor), clear: false, exit: false };
        }
        const shell = this.shellFor(actor);
        const result = await shell.run(line, { stdin });
        const trimmed = String(line ?? '').trim();
        if (trimmed) {
            this.services.get('events')?.publish?.('terminal.command', {
                command: trimmed.slice(0, 300), cwd: result.cwd,
            }, { actor: actor.username, scope: 'private', ownerId: actor.ownerId });
        }
        return result;
    }

    /** Tab completion, from the server, so it completes real paths. */
    complete (actor, prefix) {
        return this.shellFor(actor).completions(prefix || '');
    }

    /** The prompt the terminal shows: who, where, and `$` or `#`. */
    prompt (actor) {
        const shell = this.shellFor(actor);
        return {
            user: actor.username,
            host: this.config.hostname,
            cwd: shell.cwd,
            symbol: actor.role === 'admin' ? '#' : '$',
            guest: actor.guest,
        };
    }

    close (actor) {
        this.shells.delete(actor.sessionId || actor.token);
        return true;
    }

    report () { return { shells: this.shells.size }; }
}
