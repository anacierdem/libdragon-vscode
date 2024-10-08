import * as vscode from "vscode";

import * as vsctm from "vscode-textmate";
import { InstructionStatement, Operand } from "./types";
import { ALL_OPS } from "./regs";

/**
 * This function processes a line of MIPS assembly code and returns relevant stuff found in it as a abstract syntax.
 */
export function parseLine(
  currentDefines: Record<string, string[]>,
  lineIdx: number,
  line: string,
  tokens: vsctm.ITokenizeLineResult["tokens"],
): {
  statements: InstructionStatement[];
  defines: Record<string, string[]>;
} {
  function expandMacro(input: string) {
    // Support .eN syntax
    const nameParts = input.split(".");
    let output: string[] = [];
    for (let part of nameParts) {
      if (currentDefines[part]) {
        output = output.concat(currentDefines[part]);
      }
    }

    if (output.length === 0) {
      return { output: [nameParts[0]], isElement: nameParts.length > 1 };
    }

    return { output, isElement: nameParts.length > 1 };
  }

  // TODO: keep state across labels

  let statements: InstructionStatement[] = [];

  let tokenIdx = 0;
  let token = tokens[tokenIdx++];
  while (token) {
    if (token.scopes.includes("keyword.control.directive.define.c")) {
      while (token && !token.scopes.includes("support.variable")) {
        token = tokens[tokenIdx++];
      }

      if (!token) {
        // No alias found for define
        continue;
      }

      const alias = line.substring(token.startIndex, token.endIndex);
      token = tokens[tokenIdx++];

      const replacementVariables: string[] = [];
      // Find the replacement, multiple values are not supported only
      // the first one will be effective. e.g for `#define foo t1*a0
      // foo will be replaced with t1
      while (token) {
        if (token.scopes.includes("support.variable")) {
          replacementVariables.push(
            line.substring(token.startIndex, token.endIndex),
          );
        }
        token = tokens[tokenIdx++];
      }

      // TODO: discard parametric defines

      if (replacementVariables.length === 0) {
        // No replacement found for define
        continue;
      }

      // TODO: handle multi-line defines
      currentDefines[alias] = replacementVariables.flatMap(
        (t) => expandMacro(t).output,
      );
      token = tokens[tokenIdx++];
      continue;
    }

    if (token.scopes.includes("keyword.control.directive.undef.c")) {
      while (token && !token.scopes.includes("support.variable")) {
        token = tokens[tokenIdx++];
      }

      if (!token) {
        // No alias found for undef
        continue;
      }

      const alias = line.substring(token.startIndex, token.endIndex);

      delete currentDefines[alias];
      token = tokens[tokenIdx++];
      continue;
    }

    if (!token.scopes.includes("support.function.instruction")) {
      token = tokens[tokenIdx++];
      continue;
    }

    const op = line.substring(token.startIndex, token.endIndex);

    // TODO: This maybe a custom macro, we currently don't support those
    // if (!ALL_OPS.includes(op as typeof ALL_OPS[number])) {
    //     token = tokens[tokenIdx++];
    //     continue;
    // }

    let currentInstruction: InstructionStatement = {
      op: op as (typeof ALL_OPS)[number],
      operands: [[]],
      range: new vscode.Range(
        lineIdx,
        token.startIndex,
        lineIdx,
        token.endIndex,
      ),
    };
    statements.push(currentInstruction);

    while (token && !token.scopes.includes("punctuation.terminator")) {
      if (token.scopes.includes("support.variable")) {
        const { output, isElement } = expandMacro(
          line.substring(token.startIndex, token.endIndex),
        );

        const expandedOperands = output.map((name) => ({
          name,
          range: new vscode.Range(
            lineIdx,
            token.startIndex,
            lineIdx,
            token.endIndex,
          ),
          isElement: isElement,
        }));

        currentInstruction.operands[currentInstruction.operands.length - 1] =
          expandedOperands;

        token = tokens[tokenIdx++];
        continue;
      }

      if (token.scopes.includes("punctuation.separator")) {
        currentInstruction.operands.push([]);
        token = tokens[tokenIdx++];
        continue;
      }

      token = tokens[tokenIdx++];
    }
    token = tokens[tokenIdx++];
  }
  return { statements, defines: currentDefines };
}
