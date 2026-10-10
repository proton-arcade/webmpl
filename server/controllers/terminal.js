/**
 * The terminal.
 *
 * One shell per session, on the server, running as the account that typed the
 * command. For a standard account it is a jail — every filesystem call goes
 * through the same permission check as the Files application, so there is no
 * path out of their own home. For the administrator it is the machine, and only
 * the administrator may be given a shell on the host itself.
 *
 * The answer carries `effects`: things the server cannot do but the desktop
 * can, like opening a window or changing the wallpaper. A command that needs a
 * browser asks for it rather than pretending.
 */
import { BaseController } from '../lib/container.js';

export class TerminalController extends BaseController {
    static SERVICE_NAME = 'terminal';

    async _init () { this.terminal = this.services.get('terminal'); }

    /**
     * Run one line.
     *
     * `stdin` is how the desktop feeds a network command it fetched itself
     * (a `curl` of a MixtNet page piped into `grep`), which keeps the invented
     * internet in the browser where it lives and the filesystem on the server
     * where it belongs.
     */
    async run (ctx) {
        const actor = ctx.require();
        const { cmd, line, stdin } = ctx.body || {};
        const result = await this.terminal.run(actor, cmd ?? line ?? '', { stdin: stdin ?? null });
        return {
            ok: true,
            out: result.out || '',
            err: result.err || '',
            effects: result.effects || [],
            cwd: result.cwd,
            clear: !!result.clear,
            exit: !!result.exit,
            rev: result.rev,
        };
    }

    /** Tab completion, from the server, so it completes real paths. */
    complete (ctx) {
        const actor = ctx.require();
        return { ok: true, matches: this.terminal.complete(actor, ctx.query.prefix || '') };
    }

    /** The prompt: who, which machine, where, and `$` or `#`. */
    prompt (ctx) {
        const actor = ctx.require();
        return { ok: true, ...this.terminal.prompt(actor) };
    }

    close (ctx) {
        const actor = ctx.require();
        this.terminal.close(actor);
        return { ok: true };
    }
}
