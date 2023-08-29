import * as vscode from "vscode";

import * as fs from "fs";
import * as path from "path";

import * as vsctm from "vscode-textmate";

// ts doesn't like the types if imported as a module
// import * as oniguruma from "vscode-oniguruma";
const oniguruma = require("vscode-oniguruma");

function readFile(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Activated");

  const wasmBin = fs.readFileSync(
    path.join(
      __dirname,
      "../../node_modules/vscode-oniguruma/release/onig.wasm",
    ),
  ).buffer;
  const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
    return {
      createOnigScanner(patterns: any) {
        return new oniguruma.OnigScanner(patterns);
      },
      createOnigString(s: string) {
        return new oniguruma.OnigString(s);
      },
    };
  });

  // Unfortunately vscode still doesn't expose the TextMate registry so we have to
  // re-parse the file here again. Also see https://github.com/microsoft/vscode/issues/580
  // I was not able to make vscode.provideDocumentSemanticTokensLegend work
  // not sure if it would be helpful anyway
  const registry = new vsctm.Registry({
    onigLib: vscodeOnigurumaLib,
    loadGrammar: (scopeName: string) => {
      if (scopeName === "source.mips.rsp") {
        const filename = path.join(
          __dirname,
          "../../syntaxes/rsp.tmLanguage.json",
        );
        return readFile(filename).then((data) =>
          vsctm.parseRawGrammar(data.toString(), filename),
        );
      }
      console.log(`Unknown scope name: ${scopeName}`);
      return Promise.resolve(null);
    },
  });

  let highlightDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "black",
  });

  let lineDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: "Pipeline stall",
      margin: "5px",
      color: "red",
    },
  });

  let activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    triggerUpdateDecorations();
  }

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      activeEditor = editor;
      if (editor) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions,
  );

  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (activeEditor && event.document === activeEditor.document) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions,
  );

  async function triggerUpdateDecorations() {
    if (activeEditor) {
      const grammar = await registry.loadGrammar("source.mips.rsp");

      if (!grammar) {
        throw new Error("Failed to load grammar");
      }

      const text = activeEditor.document.getText().split("\n");

      let matches = [];
      let lines = [];
      let ruleStack = vsctm.INITIAL;
      for (let i = 0; i < text.length; i++) {
        const line = text[i];
        const lineTokens = grammar.tokenizeLine(line, ruleStack);

        let found = false;
        for (let j = 0; j < lineTokens.tokens.length; j++) {
          const token = lineTokens.tokens[j];

          if (token.scopes.includes("constant.numeric")) {
            matches.push({
              range: new vscode.Range(
                new vscode.Position(i, token.startIndex),
                new vscode.Position(i, token.endIndex),
              ),
            });

            found = true;
          }
        }

        if (found) {
          lines.push({
            range: new vscode.Range(i, text[i].length, i, text[i].length),
          });
        }
        ruleStack = lineTokens.ruleStack;
      }

      activeEditor.setDecorations(highlightDecoration, matches);
      activeEditor.setDecorations(lineDecoration, lines);
    }
  }
}
