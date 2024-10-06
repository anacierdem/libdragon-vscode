import * as vscode from "vscode";

import * as vsctm from "vscode-textmate";
import { InstructionStatement } from "./types";
import { ALL_OPS } from "./regs";

/**
 * This function processes a line of MIPS assembly code and returns relevant stuff found in it as a abstract syntax.
 */
export function parseLine(
  currentDefines: Record<string, string>,
  lineIdx: number,
  line: string,
  lineTokens: vsctm.ITokenizeLineResult,
): { statements: InstructionStatement[]; defines: Record<string, string> } {
  // TODO: keep state across labels

  let statements: InstructionStatement[] = [];

  let tokenIdx = 0;
  let token = lineTokens.tokens[tokenIdx++];
  while (token) {
    if (token.scopes.includes("keyword.control.directive.define.c")) {
      while (token && !token.scopes.includes("support.variable")) {
        token = lineTokens.tokens[tokenIdx++];
      }

      if (!token) {
        // No alias found for define
        continue;
      }

      const alias = line.substring(token.startIndex, token.endIndex);
      token = lineTokens.tokens[tokenIdx++];

      // Find the replacement, multiple values are not supported only
      // the first one will be effective. e.g for `#define foo t1*a0
      // foo will be replaced with t1
      while (token && !token.scopes.includes("support.variable")) {
        token = lineTokens.tokens[tokenIdx++];
      }

      if (!token) {
        // No replacement found for define
        continue;
      }

      const replacement = line.substring(token.startIndex, token.endIndex);

      // TODO: handle multi-line defines
      currentDefines[alias] = replacement;
      token = lineTokens.tokens[tokenIdx++];
      continue;
    }

    if (token.scopes.includes("keyword.control.directive.undef.c")) {
      while (token && !token.scopes.includes("support.variable")) {
        token = lineTokens.tokens[tokenIdx++];
      }

      if (!token) {
        // No alias found for undef
        continue;
      }

      const alias = line.substring(token.startIndex, token.endIndex);

      delete currentDefines[alias];
      token = lineTokens.tokens[tokenIdx++];
      continue;
    }

    if (!token.scopes.includes("support.function.instruction")) {
      token = lineTokens.tokens[tokenIdx++];
      continue;
    }

    const op = line.substring(token.startIndex, token.endIndex);

    // TODO: This maybe a custom macro, we currently don't support those
    // if (!ALL_OPS.includes(op as typeof ALL_OPS[number])) {
    //     token = lineTokens.tokens[tokenIdx++];
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
        // Support .eN syntax
        const nameParts = line
          .substring(token.startIndex, token.endIndex)
          .split(".");
        const name = nameParts[0];
        // TODO: replace all instead
        const replacedName = currentDefines[name] ?? name;
        currentInstruction.operands[
          currentInstruction.operands.length - 1
        ].push({
          name: replacedName,
          range: new vscode.Range(
            lineIdx,
            token.startIndex,
            lineIdx,
            token.endIndex,
          ),
          isElement: nameParts.length > 1,
        });
        token = lineTokens.tokens[tokenIdx++];
        continue;
      }

      if (token.scopes.includes("punctuation.separator")) {
        currentInstruction.operands.push([]);
        token = lineTokens.tokens[tokenIdx++];
        continue;
      }

      token = lineTokens.tokens[tokenIdx++];
    }
    token = lineTokens.tokens[tokenIdx++];
  }
  return { statements, defines: currentDefines };
}
