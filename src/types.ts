import * as vscode from "vscode";
import { ALL_OPS } from "./regs";

type Operand = {
  name: string;
  range: vscode.Range;
  isElement: boolean;
};

export type InstructionStatement = {
  op: (typeof ALL_OPS)[number];
  operands: Operand[][];
  range: vscode.Range;
};
