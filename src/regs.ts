// /**
// * @copyright 2023 - Max Bebök
// * @license Apache-2.0
// */

import { InstructionStatement } from "./types";

// ops that save data to RAM, and only read from regs
export const STORE_OPS = [
  "sw",
  "sh",
  "sb",
  "sbv",
  "ssv",
  "slv",
  "sdv",
  "sqv",
  "spv",
  "suv",
] as const;

export const LOAD_OPS_SCALAR = ["lw", "lh", "lhu", "lb", "lbu"] as const;
export const LOAD_OPS_VECTOR = [
  "lbv",
  "lsv",
  "llv",
  "ldv",
  "lqv",
  "lpv",
  "luv",
] as const;

// These are exceptional ops that will cause "stores after loads" kind of stalls
export const LOAD_STORE_OPS = ["mfc0", "mtc0", "mfc2", "mtc2", "cfc2", "ctc"];

// ops that load from RAM, r/w register access
export const LOAD_OPS = [...LOAD_OPS_SCALAR, ...LOAD_OPS_VECTOR];

export const BRANCH_OPS = [
  "beq",
  "bne",
  "bnez",
  "beqz",
  "bgez",
  "bgezal",
  "bgzt",
  "blez",
  "blzt",
  "bltzal",
  "j",
  "jal",
] as const;

// ops that don't write to any register
export const READ_ONLY_OPS = [...BRANCH_OPS, ...STORE_OPS, "mtc0"] as const;

export const MEM_STALL_LOAD_OPS = [
  ...LOAD_OPS,
  "mfc0",
  "mtc0",
  "mfc2",
  "mtc2",
  "cfc2",
  "ctc2",
  "catch",
] as const;

export const MEM_STALL_STORE_OPS = [
  ...STORE_OPS,
  "mfc0",
  "mtc0",
  "mfc2",
  "mtc2",
  "cfc2",
  "ctc2",
  "catch",
] as const;

export const ALL_OPS = [
  ...STORE_OPS,
  ...LOAD_OPS,
  ...BRANCH_OPS,
  "mtc0",
  "mfc0",
  "mtc2",
  "mfc2",
  "cfc2",
  "ctc2",
  "catch",
] as const;

export function getTargetRegs(statement: InstructionStatement) {
  if (READ_ONLY_OPS.includes(statement.op as (typeof READ_ONLY_OPS)[number])) {
    return [];
  }
  const targetReg = ["mtc2"].includes(statement.op)
    ? statement.operands[1]
    : statement.operands[0];
  return [targetReg].filter(Boolean);
}

export function getSourceRegs(statement: InstructionStatement) {
  if (["jr", "mtc2", "mtc0", "ctc2"].includes(statement.op)) {
    return [statement.operands[0]];
  }
  if (["beq", "bne"].includes(statement.op)) {
    return [statement.operands[0], statement.operands[1]]; // 3rd arg is the label
  }
  if (
    [
      "bgez",
      "bgezal",
      "bgzt",
      "blez",
      "blzt",
      "bltzal",
      "bnez",
      "beqz",
    ].includes(statement.op)
  ) {
    return [statement.operands[0]];
  }
  // TODO: can do this lookup ahead of time
  if (STORE_OPS.includes(statement.op as (typeof STORE_OPS)[number])) {
    return statement.operands;
  }

  if (
    [
      "add",
      "addi",
      "addiu",
      "addu",
      "and",
      "andi",
      "nor",
      "or",
      "ori",
      "sll",
      "sllv",
      "slt",
      "slti",
      "sltiu",
      "sltu",
      "sra",
      "srav",
      "srl",
      "srlv",
      "sub",
      "subu",
      "xor",
      "xori",
    ].includes(statement.op)
  ) {
    if (statement.operands.length === 2) {
      return [statement.operands[0]];
    }
  }

  if (
    [
      "vabs",
      "vadd",
      "vaddc",
      "vand",
      "vch",
      "vcl",
      "vcr",
      "veq",
      "vge",
      "vlt",
      "vmacf",
      "vmacu",
      "vmadh",
      "vmadl",
      "vmadm",
      "vmadn",
      "vmrg",
      "vmudh",
      "vmudl",
      "vmudm",
      "vmudn",
      "vmulf",
      "vmulq",
      "vmulu",
      "vnand",
      "vne",
      "vnor",
      "vnxor",
      "vor",
      "vsub",
      "vsubc",
      "vxor",
    ].includes(statement.op)
  ) {
    // TODO: check all potential regs in the third operand
    if (
      statement.operands.length === 3 &&
      statement.operands[2][0]?.isElement
    ) {
      return [statement.operands[1]];
    }
    if (statement.operands.length === 2) {
      return statement.operands;
    }
  }

  const res = statement.operands.slice(1);
  return res;
}

export function getStallLatency(op: string) {
  if (op.startsWith("v") || op === "mtc2") return 4;
  if (LOAD_OPS_VECTOR.includes(op as (typeof LOAD_OPS_VECTOR)[number]))
    return 4;
  if (LOAD_OPS_SCALAR.includes(op as (typeof LOAD_OPS_SCALAR)[number]))
    return 3;
  if (["mfc0", "mfc2", "cfc2", "ctc2"].includes(op)) return 3;
  return 0;
}
