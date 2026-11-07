/**
 * The JSON language server, in a worker.
 *
 * The twin of `yamlLSPWorker.js`, and deliberately written the same way: the
 * two services come from the same project and speak the same protocol, so the
 * difference between the files is only what JSON does differently.
 *
 * Two things, in fact. The schema is associated here rather than smuggled into
 * the document: YAML has to carry a `# yaml-language-server: $schema=` comment
 * because the server's file association does not work through this transport,
 * while the JSON service takes the association directly. And the document uri
 * is `config.json`, which is what the association matches -- this server exists
 * for that one file, which is why the schema can be named here instead of being
 * passed in.
 *
 * The schema path is relative to the origin: `schemaRequestService` turns the
 * `file://` the service resolves it to back into a fetch against the page's
 * own origin, which is what makes the same path work in the desktop build and
 * in the browser alike.
 */
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  CompletionRequest,
  createProtocolConnection,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  HoverRequest,
  InitializeRequest,
  PublishDiagnosticsNotification,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol/browser";
import { getLanguageService } from "vscode-json-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";

const SCHEMA = "/schemas/config.schema.json";

const jsonService = getLanguageService({
  async schemaRequestService(uri) {
    const res = await fetch(uri.replace("file://", self.location.origin));
    return res.text();
  },
});

jsonService.configure({
  validate: true,
  // The editor's configuration file is the one document this server is opened
  // for, so the association is unconditional. `*` rather than a name: the uri
  // is ours to choose and the match is what decides, not the file on disk.
  schemas: [{ uri: SCHEMA, fileMatch: ["*"] }],
});

const docs = {};

const conn = createProtocolConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self));

async function handleDiagnostics(uri) {
  const doc = docs[uri];
  if (!doc) return;
  const parsed = jsonService.parseJSONDocument(doc);
  const diagnostics = await jsonService.doValidation(doc, parsed);
  await conn.sendNotification(PublishDiagnosticsNotification.type, { uri, diagnostics });
}

conn.onRequest(InitializeRequest.type, () => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: true,
      hoverProvider: true,
    },
  };
});
conn.onNotification(DidOpenTextDocumentNotification.type, async ({ textDocument: { uri, languageId, version, text } }) => {
  docs[uri] = TextDocument.create(uri, languageId, version, text);
  await handleDiagnostics(uri);
});
conn.onNotification(DidChangeTextDocumentNotification.type, async ({ textDocument, contentChanges }) => {
  const doc = docs[textDocument.uri];
  if (doc) {
    docs[textDocument.uri] = TextDocument.update(doc, contentChanges, textDocument.version + 1);
    await handleDiagnostics(textDocument.uri);
  }
});
conn.onRequest(CompletionRequest.type, async ({ textDocument, position }) => {
  const doc = docs[textDocument.uri];
  if (!doc) return null;
  return jsonService.doComplete(doc, position, jsonService.parseJSONDocument(doc));
});
conn.onRequest(HoverRequest.type, async ({ textDocument, position }) => {
  const doc = docs[textDocument.uri];
  if (!doc) return null;
  return jsonService.doHover(doc, position, jsonService.parseJSONDocument(doc));
});
conn.listen();
