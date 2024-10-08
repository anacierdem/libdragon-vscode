import {
  BRANCH_OPS,
  LOAD_OPS,
  LOAD_STORE_OPS,
  STORE_OPS,
  getSourceRegs,
  getStallLatency,
  getTargetRegs,
} from "./regs";
import { InstructionStatement, Operand } from "./types";

const defaultStatus = {
  regStatus: {
    $zero: 0,
    $at: 0,
    $v0: 0,
    $v1: 0,
    $a0: 0,
    $a1: 0,
    $a2: 0,
    $a3: 0,
    $t0: 0,
    $t1: 0,
    $t2: 0,
    $t3: 0,
    $t4: 0,
    $t5: 0,
    $t6: 0,
    $t7: 0,
    $s0: 0,
    $s1: 0,
    $s2: 0,
    $s3: 0,
    $s4: 0,
    $s5: 0,
    $s6: 0,
    $s7: 0,
    $t8: 0,
    $t9: 0,
    $k0: 0,
    $k1: 0,
    $gp: 0,
    $sp: 0,
    $fp: 0,
    $ra: 0,

    $v00: 0,
    $v01: 0,
    $v02: 0,
    $v03: 0,
    $v04: 0,
    $v05: 0,
    $v06: 0,
    $v07: 0,
    $v08: 0,
    $v09: 0,
    $v10: 0,
    $v11: 0,
    $v12: 0,
    $v13: 0,
    $v14: 0,
    $v15: 0,
    $v16: 0,
    $v17: 0,
    $v18: 0,
    $v19: 0,
    $v20: 0,
    $v21: 0,
    $v22: 0,
    $v23: 0,
    $v24: 0,
    $v25: 0,
    $v26: 0,
    $v27: 0,
    $v28: 0,
    $v29: 0,
    $v30: 0,
    $v31: 0,
  },
  pairInstruction: null as InstructionStatement | null,
  loadInFlight: [] as number[],
  totalTicks: 0,
  lastInstruction: null as InstructionStatement | null,
  prevToLastInstruction: null as InstructionStatement | null,
};

type RegName = keyof (typeof defaultStatus)["regStatus"];

export type StallInfo =
  | {
      reason: typeof StallReason.DOUBLE_STALL;
      reg: string;
      cycles: number;
      operand: Operand;
    }
  | {
      reason: typeof StallReason.WRITE_LATENCY;
      reg: string;
      cycles: number;
      operand: Operand;
    }
  | {
      reason: typeof StallReason.STORE_AFTER_LOAD;
      cycles: number;
    };

export const StallReason = {
  WRITE_LATENCY: "WRITE_LATENCY",
  STORE_AFTER_LOAD: "STORE_AFTER_LOAD",
  DOUBLE_STALL: "DOUBLE_STALL",
} as const;

export const INITIAL_REG_STATUS = () => structuredClone(defaultStatus);

const tick = (status: typeof defaultStatus) => {
  // Decrease the stall counter for all registers
  for (const reg of Object.keys(status.regStatus)) {
    status.regStatus[reg as RegName] = Math.max(
      0,
      status.regStatus[reg as RegName] - 1,
    );
  }
  for (let i = 0; i < status.loadInFlight.length; i++) {
    status.loadInFlight[i]--;
    if (status.loadInFlight[i] === -1) {
      status.loadInFlight.splice(i, 1);
      i--;
    }
  }
  status.totalTicks++;
};

const isVectorOp = (statement: InstructionStatement) =>
  statement.op.startsWith("v");

const isDualIssued = (
  { pairInstruction, prevToLastInstruction }: typeof defaultStatus,
  statement: InstructionStatement,
) => {
  // TODO: Dual-issue: hardware bug with single-lane instructions
  // See https://n64brew.dev/wiki/Reality_Signal_Processor/CPU_Pipeline

  // TODO: After a branch: the first instruction on the target of a branch can
  // dual-issue only if it is 8-byte aligned. When writing a hot loop, make sure
  // the loop start (target of the end-loop branch) is 8-byte aligned so that you
  // don't lose the dual-issue opportunity on the first instruction.

  if (
    BRANCH_OPS.includes(pairInstruction?.op as (typeof BRANCH_OPS)[number]) ||
    BRANCH_OPS.includes(
      prevToLastInstruction?.op as (typeof BRANCH_OPS)[number],
    )
  ) {
    return false;
  }

  // If the first instruction of a pair writes to a vector register that is either
  // read or written by the second instruction, the pair will not dual-issue.
  // Since we are discussing vector registers here, this applies when the SU
  // instruction is one of the few that access vector registers (that is, vector
  // loads, mfc2, mtc2).

  // TODO: Similarly, CFC2/CTC2 (SU instructions) can prevent dual-issue if they
  // access a control register that is read/written by the instruction they
  // dual-issue with
  const readOrWritten = [
    ...getTargetRegs(statement),
    ...getSourceRegs(statement),
  ].flat();
  const written = pairInstruction ? getTargetRegs(pairInstruction).flat() : [];

  if (
    readOrWritten.some(({ name }) =>
      written.some(({ name: innerName }) => name === innerName),
    )
  ) {
    return false;
  }

  return (
    !!pairInstruction &&
    ((isVectorOp(pairInstruction) && !isVectorOp(statement)) ||
      (!isVectorOp(pairInstruction) && isVectorOp(statement)))
  );
};

export const finalizeStall = (status: typeof defaultStatus, count: number) => {
  for (let i = 0; i < count; i++) {
    tick(status);
  }
  return status;
};

export function analyzeInstruction(
  status: typeof defaultStatus,
  instruction: InstructionStatement,
) {
  let stalls: StallInfo[] = [];

  const sourceRegs = getSourceRegs(instruction);

  for (const potentialSourceRegs of sourceRegs) {
    for (const sourceReg of potentialSourceRegs) {
      let regName = sourceReg.name;
      let regMatch = status.regStatus.hasOwnProperty(regName);
      if (!regMatch) {
        regName = "$" + sourceReg.name;
        regMatch = status.regStatus.hasOwnProperty(regName);
      }
      if (regMatch && status.regStatus[regName as RegName] > 0) {
        const stallCount = status.regStatus[regName as RegName];
        stalls.push({
          reason: StallReason.WRITE_LATENCY,
          reg: regName,
          cycles: stallCount,
          operand: sourceReg,
        });
      }
    }
  }

  if (
    [...STORE_OPS, ...LOAD_STORE_OPS].includes(
      instruction.op as (typeof STORE_OPS)[number],
    )
  ) {
    for (let i = 0; i < status.loadInFlight.length; i++) {
      if (status.loadInFlight[i] === 0) {
        stalls.push({
          reason: StallReason.STORE_AFTER_LOAD,
          cycles: 1,
        });
        break;
      }
    }
  }

  // find stall with max cycles
  const { stall } = stalls.reduce<{
    max: number;
    stall: null | StallInfo;
  }>(
    (acc, curr) => {
      if (curr.cycles > acc.max) {
        return { max: curr.cycles, stall: curr };
      }
      return acc;
    },
    { max: 0, stall: null },
  );

  return stall;
}

export function analyze(
  status: typeof defaultStatus,
  instruction: InstructionStatement,
) {
  const dualIssued = isDualIssued(status, instruction);

  // Finalize the last instruction if it was dual-issued
  if (!dualIssued) {
    tick(status);
  }

  const stall = analyzeInstruction(status, instruction);

  if (!dualIssued) {
    status.pairInstruction = instruction;
  } else {
    // Dual issue already processed, clear the state
    // Next instruction must not dual issue
    status.pairInstruction = null;
  }

  finalizeStall(status, stall?.cycles ?? 0);

  status.prevToLastInstruction = status.lastInstruction;
  status.lastInstruction = instruction;

  return { stall, status };
}

export function updateTargets(
  status: typeof defaultStatus,
  instruction: InstructionStatement,
) {
  const targetRegs = getTargetRegs(instruction);
  for (const potentialTargetRegs of targetRegs) {
    for (const targetReg of potentialTargetRegs) {
      let regName = targetReg.name;
      let regMatch = status.regStatus.hasOwnProperty(regName);
      if (!regMatch) {
        regName = "$" + targetReg.name;
        regMatch = status.regStatus.hasOwnProperty(regName);
      }
      const latency = getStallLatency(instruction.op);
      if (regMatch) {
        status.regStatus[regName as RegName] = latency;
      }
    }
  }

  if (
    [...LOAD_OPS, ...LOAD_STORE_OPS].includes(
      instruction.op as (typeof LOAD_OPS)[number],
    )
  ) {
    status.loadInFlight.push(2);
  }

  return status;
}
