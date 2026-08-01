import { env } from "../env";

type EslResult = { ok: boolean; body: string };

async function eslCommand(
  command: string,
  timeoutMs = 5000,
): Promise<EslResult> {
  if (!env.fsEslPassword) {
    return { ok: false, body: "FS_ESL_PASSWORD is not set" };
  }

  return new Promise<EslResult>((resolve) => {
    let buffer = "";
    let authenticated = false;
    let settled = false;

    const finish = (result: EslResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.end();
      } catch {
      }
      resolve(result);
    };

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          body: `ESL command timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    );

    let socket: { write: (s: string) => void; end: () => void } | undefined;

    Bun.connect({
      hostname: env.fsEslHost,
      port: env.fsEslPort,
      socket: {
        open(sock) {
          socket = sock;
        },
        data(sock, chunk) {
          buffer += chunk.toString();

          if (!authenticated && buffer.includes("auth/request")) {
            authenticated = true;
            buffer = "";
            sock.write(`auth ${env.fsEslPassword}\n\n`);
            return;
          }

          if (
            authenticated &&
            buffer.includes("+OK accepted") &&
            !buffer.includes("api/response")
          ) {
            buffer = "";
            sock.write(`api ${command}\n\n`);
            return;
          }

          if (buffer.includes("-ERR invalid")) {
            finish({ ok: false, body: "ESL authentication rejected" });
            return;
          }

          const match = buffer.match(
            /Content-Length:\s*(\d+)\r?\n\r?\n([\s\S]*)$/,
          );
          if (match) {
            const expected = Number(match[1]);
            const body = match[2] ?? "";
            if (Buffer.byteLength(body) >= expected) {
              finish({ ok: true, body: body.trim() });
            }
          }
        },
        error(_sock, err) {
          finish({ ok: false, body: `ESL socket error: ${err.message}` });
        },
        close() {
          finish({ ok: false, body: "ESL connection closed before a reply" });
        },
      },
    }).catch((err: Error) =>
      finish({ ok: false, body: `ESL connect failed: ${err.message}` }),
    );
  });
}

export const esl = {
  api: eslCommand,

  async flushXmlCache(user?: string, domain?: string): Promise<boolean> {
    const cmd =
      user && domain
        ? `xml_flush_cache id ${user} ${domain}`
        : "xml_flush_cache";
    const { ok, body } = await eslCommand(cmd);
    if (!ok) {
      console.warn(`[esl] ${cmd} failed: ${body}`);
    }
    return ok;
  },

  async status(timeoutMs = 1000): Promise<EslResult> {
    return eslCommand("status", timeoutMs);
  },

  async showCalls(): Promise<EslResult> {
    return eslCommand("show calls count");
  },
};
