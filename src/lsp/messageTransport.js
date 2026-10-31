import { Transport } from "@open-rpc/client-js/src/transports/Transport";
import { getNotifications } from "@open-rpc/client-js/src/Request";

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
