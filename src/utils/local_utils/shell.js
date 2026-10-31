/**
 * Running a command line, on the three platforms.
 *
 * Extracted from `mystExport.js`, where it grew: every line of it is there
 * because something broke on one platform and not the others -- a `.bat` under
 * Windows because no quoting of ours survives `cmd.exe`, raw bytes because the
 * shell plugin rejects a whole call over one byte of a legacy code page, a
 * shell that cannot start turned into an ordinary failure rather than a
 * rejection nobody catches. Anything else that needs to run a command -- git,
 * to begin with -- should inherit that experience rather than repeat it.
 *
 * The module knows nothing of myst: the environment is a parameter, and each
 * caller says what its own commands need.
 */

import { isWindows } from "./fs.js";

/** Scope names declared in src-tauri/capabilities/default.json. */
export const LOGIN_SHELL = "login-shell";
export const WINDOWS_SHELL = "windows-shell";

/** Quote a value for a POSIX shell. */
export const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * Quote a value for the shell in use.
 *
 * `cmd.exe` knows only the double quote and has no escape for it -- which costs
 * nothing here, since Windows forbids it in a file name.
 */
export const q = (s) => (isWindows ? `"${String(s).replace(/"/g, "").replace(/\//g, "\\")}"` : shq(s));

/**
 * Decode what a command printed, without ever being able to fail.
 *
 * The shell plugin decodes the output as UTF-8 and rejects the whole call when
 * one byte does not fit: `invalid utf-8 sequence of 1 bytes from index 85`,
 * raised as if the shell could not be started, taking the exit code, the
 * output and any chance of a diagnosis with it. On Windows that is the normal
 * case and not the exception -- `cmd.exe` and the tools it runs write in the
 * machine's legacy code page, so a single accented character in a message from
 * latexmk or myst was enough to lose the export.
 *
 * Asking for the bytes and decoding them here cannot fail, which is the point:
 * a non-fatal decoder substitutes U+FFFD rather than throwing. It is the net
 * under the `chcp 65001` in `runShell`, not the cure -- the cure is making the
 * output UTF-8 in the first place, the active code page being quite possibly
 * one nothing here can decode. The second pass as windows-1252 covers the
 * common Western case and leaves the text approximate elsewhere; approximate
 * text beats a lost exit code.
 */
export const decodeOutput = (data) => {
  if (typeof data === "string") return data;
  if (!data || !data.length) return "";
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return utf8;
  }
};

/**
 * Hand a command line to `cmd.exe` through a file, because it cannot be handed
 * over as an argument.
 *
 * Rust quotes each argument of a process it starts in the MSVC convention,
 * which escapes an inner double quote as a backslash-quote pair. `cmd.exe`
 * knows nothing of that escape: it leaves the backslash alone, and the program
 * cmd then starts reads the pair through its own CRT, which turns it back into
 * a literal quote. A line holding `myst build "doc.md" --tex` therefore
 * reaches myst as a file named `"doc.md"`, quotes included -- which exists
 * nowhere, so myst falls back to exporting the project and the document
 * exported is whichever article the project happens to list. myst's own log is
 * where this was finally read, in its `$file` field:
 * `...\\Documents\\"tst-exercisebis.md"`.
 *
 * No quoting of ours survives that path, so none is attempted on it. The line
 * goes into a `.bat` written under the application's config folder, where we
 * decide the quoting, and cmd is given the script's path -- a single argument
 * holding no quote, which Rust passes through untouched.
 *
 * `%` is doubled, since a batch file expands `%NAME%` and a file name may hold
 * one. `chcp 65001` sits in the script rather than being chained with `&`: see
 * `decodeOutput` for why the output has to be UTF-8.
 *
 * Two names rather than one: cmd reads a batch file as it goes, so the
 * long-running `myst start` keeps a script of its own instead of having it
 * overwritten under its feet by the next export.
 */
export async function windowsScript(line, name) {
  const { writeTextFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { appConfigDir, join } = await import("@tauri-apps/api/path");
  const dir = await appConfigDir();
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    /* already there, which is the usual case */
  }
  const path = await join(dir, name);
  await writeTextFile(path, `@echo off\r\nchcp 65001>nul\r\n${line.replace(/%/g, "%%")}\r\n`);
  return path;
}

export async function runShell(line, cwd, env = {}) {
  const { Command } = await import("@tauri-apps/plugin-shell");
  // `/d` keeps an AutoRun entry from changing the directory under us, and `/s`
  // makes cmd strip the outer quotes and take the rest of the line verbatim --
  // without it, a line holding quoted paths is re-parsed and falls apart.
  // On Windows the line goes through a script rather than an argument; see
  // `windowsScript`. If it cannot be written, the inline form is still better
  // than nothing: it works for every command that needs no quoting, and it
  // still asks for UTF-8 output.
  let winArg = null;
  if (isWindows) {
    try {
      winArg = await windowsScript(line, "mystral-run.bat");
    } catch (err) {
      console.warn("[export] the command script could not be written:", err);
    }
  }
  const [scope, args] = isWindows ? [WINDOWS_SHELL, ["/d", "/s", "/c", winArg ?? `chcp 65001>nul & ${line}`]] : [LOGIN_SHELL, ["-lc", line]];
  console.log("[export]", scope, JSON.stringify(args), cwd ? `(cwd: ${cwd})` : "");

  try {
    // `encoding: "raw"` hands back the bytes; see `decodeOutput`.
    const opts = { env, encoding: "raw" };
    if (cwd) opts.cwd = cwd;
    const out = await Command.create(scope, args, opts).execute();
    const res = { ...out, stdout: decodeOutput(out.stdout), stderr: decodeOutput(out.stderr) };
    if (res.code !== 0) console.log("[export] exit", res.code, "\n", res.stdout, "\n", res.stderr);
    return { ...res, scope };
  } catch (err) {
    // A shell that cannot even be started -- a scope the capabilities do not
    // declare, a program that is not there -- used to reject and vanish: an
    // export is reached from an asynchronous toast callback, where nothing
    // catches. Turning it into an ordinary failure is what makes it visible.
    console.error("[export] could not start the shell:", scope, err);
    return { code: -1, stdout: "", stderr: String(err?.message ?? err), scope };
  }
}

/**
 * Run a command that may never finish, and give up on it.
 *
 * `runShell` awaits `execute()`, which waits for the process to end. That is
 * right for everything that reads or writes locally and wrong for anything
 * that talks to a network: git asks for a password on its terminal, and this
 * one has no terminal and no one in front of it. `GIT_TERMINAL_PROMPT=0` turns
 * most of those into an error, but not all -- an ssh helper, a proxy, a host
 * that accepts the connection and then says nothing -- and the application
 * would simply stop answering, with no button to press.
 *
 * So the process is spawned rather than awaited, its output collected as it
 * comes, and it is killed if it outstays the deadline. `Child.kill()` is the
 * one thing the plugin gives us for that.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string, timedOut: boolean}>}
 */
export async function runShellLimited(line, { cwd, env = {}, timeoutMs = 30000 } = {}) {
  const { Command } = await import("@tauri-apps/plugin-shell");

  let winArg = null;
  if (isWindows) {
    try {
      winArg = await windowsScript(line, "mystral-net.bat");
    } catch (err) {
      console.warn("[shell] the command script could not be written:", err);
    }
  }
  const [scope, args] = isWindows
    ? [WINDOWS_SHELL, ["/d", "/s", "/c", winArg ?? `chcp 65001>nul & ${line}`]]
    : [LOGIN_SHELL, ["-lc", line]];
  console.log("[shell]", scope, JSON.stringify(args), cwd ? `(cwd: ${cwd})` : "");

  const opts = { env, encoding: "raw" };
  if (cwd) opts.cwd = cwd;
  const command = Command.create(scope, args, opts);

  const chunks = { stdout: [], stderr: [] };
  const collect = (where) => (data) => {
    if (typeof data === "string") chunks[where].push(new TextEncoder().encode(data));
    else chunks[where].push(data instanceof Uint8Array ? data : new Uint8Array(data));
  };
  command.stdout.on("data", collect("stdout"));
  command.stderr.on("data", collect("stderr"));

  const joined = (where) => {
    const parts = chunks[where];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.length;
    }
    return decodeOutput(all);
  };

  return new Promise((resolve) => {
    let child = null;
    let timer = null;
    let done = false;
    const finish = (code, timedOut) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: joined("stdout"), stderr: joined("stderr"), timedOut });
    };

    command.on("close", ({ code }) => finish(code ?? -1, false));
    command.on("error", (err) => {
      chunks.stderr.push(new TextEncoder().encode(String(err)));
      finish(-1, false);
    });

    command
      .spawn()
      .then((spawned) => {
        child = spawned;
        timer = setTimeout(() => {
          // Said before killing: the output collected so far is often the whole
          // diagnosis -- a host name, a refused key -- and it would be lost in
          // a bare "timed out".
          console.warn("[shell] no answer after", timeoutMs, "ms, stopping:", line);
          child?.kill?.().catch(() => {});
          finish(-1, true);
        }, timeoutMs);
      })
      .catch((err) => {
        chunks.stderr.push(new TextEncoder().encode(String(err?.message ?? err)));
        finish(-1, false);
      });
  });
}
