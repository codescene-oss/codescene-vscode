import vscode from 'vscode';
import { logOutputChannel } from '../../log';

type ProvidedSymbol = vscode.DocumentSymbol | vscode.SymbolInformation;

function symbolPosition(symbol: ProvidedSymbol): vscode.Position {
  return 'location' in symbol ? symbol.location.range.start : symbol.selectionRange.start;
}

function findSymbol(symbols: readonly ProvidedSymbol[], name: string): ProvidedSymbol | undefined {
  for (const symbol of symbols) {
    if (symbol.name === name) return symbol;
    const children = 'children' in symbol ? symbol.children : [];
    const found = findSymbol(children, name);
    if (found) return found;
  }
  return undefined;
}

export async function findFunctionPosition(document: vscode.TextDocument, name: string | undefined): Promise<vscode.Position | undefined> {
  if (!name) return undefined;
  try {
    const symbols = await vscode.commands.executeCommand<ProvidedSymbol[] | undefined>('vscode.executeDocumentSymbolProvider', document.uri);
    const symbol = findSymbol(symbols ?? [], name);
    return symbol && symbolPosition(symbol);
  } catch (e) {
    logOutputChannel.warn(`Could not look up ${name} in ${document.fileName}: ${e}`);
    return undefined;
  }
}
