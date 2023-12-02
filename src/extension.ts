import * as vscode from "vscode";

import * as fs from "fs";
import * as path from "path";

import * as vsctm from "vscode-textmate";

// ts doesn't like the types if imported as a module
// import * as oniguruma from "vscode-oniguruma";
const oniguruma = require("vscode-oniguruma");

type Operand = {
  name: string;
  range: vscode.Range;
};

type Instruction = {
  name: string;
  operands: (Operand | undefined)[];
  range: vscode.Range;
  lineRange: vscode.Range;
};

function readFile(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

// TODO: optimize this
const MAX_LOOKBEHIND = 100;

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

  function getTarget(instruction: Instruction) {
    switch (instruction.name) {
      default:
        return instruction.operands[0];
    }
  }

  function getSources(instruction: Instruction) {
    switch (instruction.name) {
      default:
        return instruction.operands.slice(1);
    }
  }

  let dualIssued = false;
  function getCycles(instructions: Instruction[]) {
    const lastInstruction = instructions[instructions.length - 1];
    const prevInstruction = instructions[instructions.length - 2];

    if (dualIssued) {
      dualIssued = false;
      return 0;
    }

    if (
      lastInstruction.name.startsWith("v") &&
      !prevInstruction?.name.startsWith("v")
    ) {
      dualIssued = true;
      return 0;
    }

    if (
      !lastInstruction.name.startsWith("v") &&
      prevInstruction?.name.startsWith("v")
    ) {
      dualIssued = true;
      return 0;
    }

    // TODO: handle other cases
    return 1;
  }

  function getLatency(instruction: Instruction) {
    if (instruction.name?.startsWith("v")) {
      return 4;
    }
    return 1;
  }

  const lineDecorations: vscode.DecorationOptions[] = [];
  const wordDecorations: vscode.DecorationOptions[] = [];
  const prevInstructions: Instruction[] = [];
  async function analyzeInstruction(currentInstruction: Instruction) {
    const len = prevInstructions.length;
    const finalInstructions = [...prevInstructions, currentInstruction];

    let cycleDiff = getCycles(finalInstructions);
    for (let i = 0; i < len; i++) {
      const instructionToTest = prevInstructions[len - i - 1];
      const target = getTarget(instructionToTest);

      const latencyDiff = getLatency(instructionToTest) - cycleDiff;

      if (
        target &&
        getSources(currentInstruction)
          .filter<Operand>((f): f is Operand => !!f)
          .find(
            ({ name }) => target.name.split(".")[0] === name.split(".")[0],
          ) &&
        latencyDiff > 0
      ) {
        // Stalled
        cycleDiff += latencyDiff;

        if (
          lineDecorations[lineDecorations.length - 1]?.range !==
          currentInstruction.lineRange
        ) {
          lineDecorations.push({
            range: currentInstruction.lineRange,
          });
        }
        wordDecorations.push({
          range: currentInstruction.range,
        });
      }

      cycleDiff += getCycles(prevInstructions.slice(0, len - i));
    }
    prevInstructions.push(currentInstruction);

    while (prevInstructions.length > MAX_LOOKBEHIND) {
      prevInstructions.shift();
    }
  }

  async function triggerUpdateDecorations() {
    prevInstructions.length = 0;
    lineDecorations.length = 0;
    wordDecorations.length = 0;
    if (activeEditor) {
      const grammar = await registry.loadGrammar("source.mips.rsp");

      if (!grammar) {
        throw new Error("Failed to load grammar");
      }

      const text = activeEditor.document.getText().split("\n");

      let ruleStack = vsctm.INITIAL;
      for (let i = 0; i < text.length; i++) {
        const line = text[i];
        const lineTokens = grammar.tokenizeLine(line, ruleStack);

        let operandIndex = 0;
        let currentInstruction: Instruction | null = null;
        for (let j = 0; j < lineTokens.tokens.length; j++) {
          const token = lineTokens.tokens[j];

          if (token.scopes.includes("punctuation.terminator") || j == 0) {
            currentInstruction && analyzeInstruction(currentInstruction);

            currentInstruction = null;
            operandIndex = 0;
            continue;
          }

          if (token.scopes.includes("support.function.instruction")) {
            currentInstruction = currentInstruction || {
              name: line.substring(token.startIndex, token.endIndex),
              operands: [],
              range: new vscode.Range(i, token.startIndex, i, token.endIndex),
              lineRange: new vscode.Range(i, text[i].length, i, text[i].length),
            };
            continue;
          }

          if (token.scopes.includes("punctuation.separator")) {
            operandIndex++;
            continue;
          }

          if (token.scopes.includes("support.variable")) {
            if (!currentInstruction) {
              continue;
            }

            currentInstruction.operands[operandIndex] = {
              name: line.substring(token.startIndex, token.endIndex),
              range: new vscode.Range(i, token.startIndex, i, token.endIndex),
            };
            continue;
          }

          // TODO: bail out if something else is found
        }

        ruleStack = lineTokens.ruleStack;
      }

      activeEditor.setDecorations(lineDecoration, lineDecorations);
      activeEditor.setDecorations(highlightDecoration, wordDecorations);
    }
  }
}
