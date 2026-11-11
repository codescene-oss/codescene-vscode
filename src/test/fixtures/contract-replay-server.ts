/**
 * A cs-ide server stand-in that delivers contract fixtures verbatim, so the production client decodes
 * them the way it decodes the real CLI's frames.
 *
 *   node contract-replay-server.js <start-params.json>
 *
 * sends the file's content as the cs-ide/start notification, then serves:
 *   test/respond  {method, result}                 answer the next requests for `method` with `result`
 *   test/respond  {method, error: {code, message, data?}}   answer them with a JSON-RPC error
 *   test/notify   {method, params}                 send `params` as a notification of `method`
 * Any other request is answered with JSON-RPC "method not found".
 *
 * It also records what it receives, so outbound contract tests can read the params the client really put on
 * the wire:
 *   test/captured  {}                              return every request and notification received since the
 *                                                  last call, as [{kind, method, params}], and forget them
 */
import * as fs from 'fs';
import { createMessageConnection, ResponseError } from 'vscode-jsonrpc/node';

interface Response {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const METHOD_NOT_FOUND = -32601;
const responses = new Map<string, Response>();
const captured: Array<{ kind: 'request' | 'notification'; method: string; params: unknown }> = [];
const connection = createMessageConnection(process.stdin, process.stdout);

connection.onRequest('test/respond', ({ method, ...response }: { method: string } & Response) => {
  responses.set(method, response);
  return null;
});
connection.onRequest('test/notify', async ({ method, params }: { method: string; params: unknown }) => {
  await connection.sendNotification(method, params);
  return null;
});
connection.onRequest('test/captured', () => captured.splice(0));
connection.onNotification((method: string, params: unknown) => {
  captured.push({ kind: 'notification', method, params });
});
connection.onRequest((method: string, params: unknown) => {
  captured.push({ kind: 'request', method, params });
  const response = responses.get(method);
  if (!response) {
    throw new ResponseError(METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
  if (response.error) {
    throw new ResponseError(response.error.code, response.error.message, response.error.data);
  }
  return response.result ?? null;
});

connection.listen();
void connection.sendNotification('cs-ide/start', JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
