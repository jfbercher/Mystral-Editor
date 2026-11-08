/**
 * The transport between the language-server client and its worker.
 *
 * It imported two things from `@open-rpc/client-js/src/…` -- the `Transport`
 * base class and `getNotifications` -- and uses neither since this was
 * rewritten as a plain object: the client this fork uses expects the
 * handler-list interface, not the inherited one. The imports stayed behind,
 * and they were not harmless. They reach into that package's **TypeScript
 * source**, which the bundler then has to parse; one of those files declares
 * `public abstract async sendData(...)`, which TypeScript does not allow, and
 * a stricter bundler refuses the whole dependency scan over it:
 *
 *   [PARSE_ERROR] 'async' modifier cannot be used with 'abstract' modifier.
 *
 * Importing another package's source rather than what it publishes is the
 * actual mistake; the stricter bundler only revealed it.
 */
export default class PostMessageWorkerTransport {
  constructor(worker) {
    this.worker = worker;
    this.messageHandlers = [];
    this.closeHandlers = [];
    this.errorHandlers = [];
    worker.addEventListener("message", (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data);
      this.messageHandlers.forEach((h) => h(raw));
    });
    worker.addEventListener("error", (ev) => {
      this.errorHandlers.forEach((h) => h(new Error(ev.message || "Worker error")));
    });
  }
  send(message) { this.worker.postMessage(JSON.parse(message)); }
  onMessage(cb) { this.messageHandlers.push(cb); }
  onClose(cb) { this.closeHandlers.push(cb); }
  onError(cb) { this.errorHandlers.push(cb); }
  close() {
    this.worker.terminate();
    this.closeHandlers.forEach((h) => h());
  }
}
