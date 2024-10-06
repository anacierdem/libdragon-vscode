import * as vscode from "vscode";

import * as fs from "fs";
import * as path from "path";

import * as vsctm from "vscode-textmate";
import { parseLine } from "./parseLine";
import {
  INITIAL_REG_STATUS as INITIAL_STATUS,
  StallReason,
  analyze as analyzeStatement,
} from "./analyze";

// ts doesn't like the types if imported as a module
// import * as oniguruma from "vscode-oniguruma";
const oniguruma = require("vscode-oniguruma");

function readFile(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

let diagnosticCollection: vscode.DiagnosticCollection;

export async function analyzeStalls(
  document: vscode.TextDocument,
  grammar: vsctm.IGrammar,
) {
  let currentDefines: Record<string, string> = {
    // This is defined by convention in libdragon
    ra2: "sp",
  };
  let status = INITIAL_STATUS();

  let stalledStatements = [];

  let ruleStack = vsctm.INITIAL;
  for (let lineIdx = 0; lineIdx < document.lineCount; lineIdx++) {
    const line = document.lineAt(lineIdx).text;
    const { ruleStack: newRuleStack, tokens } = grammar.tokenizeLine(
      line,
      ruleStack,
    );
    ruleStack = newRuleStack;

    const { statements, defines } = parseLine(
      currentDefines,
      lineIdx,
      line,
      tokens,
    );
    currentDefines = defines;

    if (!statements.length) {
      continue;
    }

    for (const statement of statements) {
      const { status: newStatus, stalled } = analyzeStatement(
        status,
        statement,
      );
      status = newStatus;

      if (stalled) {
        stalledStatements.push({ statement, info: stalled });
      }
    }
  }

  return { stalledStatements, totalTicks: status.totalTicks };
}

export async function loadGrammar() {
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
  // TODO: add this to disposables
  const registry = new vsctm.Registry({
    onigLib: vscodeOnigurumaLib,
    loadGrammar: (scopeName: string) => {
      if (scopeName === "source.mips.rsp") {
        const filename = path.join(
          __dirname,
          "../../syntaxes/mips.rsp.tmLanguage.json",
        );
        return readFile(filename).then((data) =>
          vsctm.parseRawGrammar(data.toString(), filename),
        );
      }
      return Promise.resolve(null);
    },
  });

  const grammar = await registry.loadGrammar("source.mips.rsp");

  if (!grammar) {
    throw new Error("Failed to load grammar");
  }

  return grammar;
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("Activating mips.rsp extension");

  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("mips.rsp");
  context.subscriptions.push(diagnosticCollection);

  const grammar = await loadGrammar();

  let activeEditor = vscode.window.activeTextEditor;
  activeEditor && handleChange(activeEditor, grammar);

  let stallStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  context.subscriptions.push(stallStatusBar);

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      // TODO: can we get rid of this?
      activeEditor = editor;
      activeEditor && handleChange(activeEditor, grammar);
    },
    null,
    context.subscriptions,
  );

  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (activeEditor && event.document === activeEditor.document) {
        handleChange(activeEditor, grammar);
      }
    },
    null,
    context.subscriptions,
  );

  async function handleChange(
    editor: vscode.TextEditor,
    grammar: vsctm.IGrammar,
  ) {
    diagnosticCollection.clear();

    if (
      editor.document.languageId !== "mips.rsp" &&
      editor.document.languageId !== "mips"
    ) {
      stallStatusBar.hide();
    }
    stallStatusBar.show();

    // TODO: stream these instead
    const result = await analyzeStalls(editor.document, grammar);

    stallStatusBar.text =
      editor.document.languageId === "mips.rsp"
        ? `${result.totalTicks} total cycles, ${result.stalledStatements.length} stalled`
        : `${result.totalTicks} total cycles`;

    if (editor.document.languageId !== "mips.rsp") {
      return;
    }

    const uri = vscode.Uri.file(editor.document.fileName);
    const diags = [];
    for (const stall of result.stalledStatements) {
      let message = "";
      if (stall.info.reason === StallReason.WRITE_LATENCY) {
        message =
          "Pipeline stall: " +
          stall.info.cycles +
          " cycle (reading from " +
          stall.info.operand?.name +
          ")";
      } else if (stall.info.reason === StallReason.STORE_AFTER_LOAD) {
        message = "Pipeline stall: store after load";
      }
      // TODO: add more information to the diagnostic
      diags.push(
        new vscode.Diagnostic(
          stall.info.reason === StallReason.WRITE_LATENCY
            ? stall.info.operand.range
            : stall.statement.range,
          message,
          vscode.DiagnosticSeverity.Warning,
        ),
      );
    }
    diagnosticCollection.set(uri, diags);
  }

  console.log("Activated mips.rsp extension");
}
