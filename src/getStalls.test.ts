import * as assert from "assert";
import * as vscode from "vscode";

import { analyzeStalls, loadGrammar } from "./extension";
import { IGrammar } from "vscode-textmate";
import { StallReason } from "./analyze";

describe("analyzeStalls", () => {
  let grammar: IGrammar;

  before(async () => {
    grammar = await loadGrammar();
  });

  it("should create correct stalls for a simple vector inst. stall", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vsubc $v02, $v10, $v11   # Writes to $v02
        vlt $v02, $v02, $v12     # Reads from $v02 => STALL (3 cycles)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);
    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vlt");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 3);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v02");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(2, 18, 2, 22),
    );
  });

  it("should not create stalls for a properly delayed vector inst.", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vsubc $v02, $v10, $v11 # Writes to $v02
        vnop
        vnop
        vnop
        vlt $v02, $v02, $v12 # Reads from $v02 => NO STALL (it's on the 4th cycle after vsubc)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);
    assert.strictEqual(result.stalledStatements.length, 0);
  });

  it("should not create stalls for a properly delayed vector inst. with dual issue", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vsubc $v02, $v10, $v11 # Writes to $v02
        nop
        nop
        nop
        nop
        nop
        vlt $v02, $v02, $v12 # Reads from $v02 => NO STALL (it's on the 4th cycle after vsubc)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 0);
  });

  it("should create correct stall for a shorthand SU inst. reading a loaded value", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)    # Writes to t0
        sll t0, 2       # Reads from t0 => STALL (2 cycles)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 4);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "sll");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$t0");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(2, 12, 2, 14),
    );
  });

  it("should create correct stall for a full SU inst. reading a loaded value", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)    # Writes to t0
        nop
        sub t1, t0, 2   # Reads from t0 => STALL (1 cycle)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 4);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "sub");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 1);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$t0");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 16, 3, 18),
    );
  });

  it("should create correct stall for a shorthand VU inst. reading a loaded value", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lpv $v00, 0(s0)       # Writes to $v00
        vabs $v00, $v01       # Reads from $v00 => STALL (3 cycles)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vabs");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 3);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v00");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(2, 13, 2, 17),
    );
  });

  it("should create correct stall for a store after load when the delay is 2 cycles", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)
        nop
        sqv $v04, 0(s1)    # STALL: write happening two cycles after load`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 4);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "sqv");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.STORE_AFTER_LOAD,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 1);
    assert.deepStrictEqual(
      result.stalledStatements[0].statement.range,
      new vscode.Range(3, 8, 3, 11),
    );
  });

  it("should create correct stall for a store after load & mtc0", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)
        nop
        mtc0 v0, COP0_SP_STATUS     # STALL: mtc0 happening two cycles after load`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 4);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "mtc0");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.STORE_AFTER_LOAD,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 1);
    assert.deepStrictEqual(
      result.stalledStatements[0].statement.range,
      new vscode.Range(3, 8, 3, 12),
    );
  });

  it("should create correct stall for a store after load & mtc0", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)
        nop
        mfc0 v0, COP0_SP_STATUS     # STALL: mtc0 happening two cycles after load`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 4);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "mfc0");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.STORE_AFTER_LOAD,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 1);
    assert.deepStrictEqual(
      result.stalledStatements[0].statement.range,
      new vscode.Range(3, 8, 3, 12),
    );
  });

  it("should create correct stall for a load by mtc2 & read by sw", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        mtc2 t0, $v04.e2
        nop
        sw t8, 4(s1)                # STALL: "sw" happening two cycles after "mtc2"`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 4);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "sw");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.STORE_AFTER_LOAD,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 1);
    assert.deepStrictEqual(
      result.stalledStatements[0].statement.range,
      new vscode.Range(3, 8, 3, 10),
    );
  });

  it("should create correct stall for a load by mtc2 & read by cfc2", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        mtc2 t0, $v04.e0
        nop
        cfc2 v0, COP2_VCC           # STALL: cfc2 happening two cycles after mtc2`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 4);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "cfc2");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.STORE_AFTER_LOAD,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 1);
    assert.deepStrictEqual(
      result.stalledStatements[0].statement.range,
      new vscode.Range(3, 8, 3, 12),
    );
  });

  it("should create 1 cycle stall for a dual issued assembly listing", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vand $v01, $v07, $v07.q1;                 lqv $v03.e0, 0x00,s0
        vch $v02, $v08, $v08.q1;                  lsv $v04.e0, 0x10,s0
        vmacu $v01, $v01, $v01.h2;                lqv $v05.e0, 0x20,s0`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vmacu");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v01");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 20, 3, 24),
    );
  });

  it("should create 1 cycle stall without .eN syntax for 3 operand vector inst.", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vmudm $v01, $v07, $v07.q1;                lpv $v03.e0, 0x00,s0
        vmulf $v02, $v08, $v07.q1;                luv $v04.e0, 0x10,s0
        vmadm $v01, $v01, 3;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vmadm");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v01");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 20, 3, 24),
    );
  });

  it("should keep track of a current target's state while executing the last stall", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
      vmacf $v08, $v06, $v10;
      vaddc $v01, $v07, $v07.q1;                lqv $v03.e0, 0x00,s0
      vmulu $v02, $v08, $v08.q1;                lqv $v04.e0, 0x10,s0
      vaddc $v01, $v01, $v01.h2;                lqv $v05.e0, 0x20,s0
      vor $v02, $v02, $v02.h2;                  lqv $v06.e0, 0x30,s0
      vaddc $v01, $v01, $v01.e4;                bnez t0, Label
      vsubc $v02, $v02, $v02.e4;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 13);

    assert.strictEqual(result.stalledStatements.length, 3);

    assert.strictEqual(result.stalledStatements[0].statement.op, "vmulu");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v08");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 18, 3, 22),
    );

    assert.strictEqual(result.stalledStatements[1].statement.op, "vor");
    assert.strictEqual(
      result.stalledStatements[1].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[1].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[1].info.reg, "$v02");
    assert.deepStrictEqual(
      result.stalledStatements[1].info.operand.range,
      new vscode.Range(5, 16, 5, 20),
    );

    assert.strictEqual(result.stalledStatements[2].statement.op, "vsubc");
    assert.strictEqual(
      result.stalledStatements[2].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[2].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[2].info.reg, "$v02");
    assert.deepStrictEqual(
      result.stalledStatements[2].info.operand.range,
      new vscode.Range(7, 18, 7, 22),
    );
  });

  it("should create correct stall with .eN syntax shorthand vector inst.", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vmulu $v01, $v07, $v07.q1;                lqv $v03.e0, 0x00,s0
        vmadl $v02, $v08, $v08.q1;                llv $v04.e0, 0x10,s0
        vxor $v01, $v03.e1;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vxor");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v01");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 13, 3, 17),
    );
  });

  it("should create correct stall with .eN syntax shorthand vector inst.'s second operand", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vmrg $v01, $v07, $v07.q1;                 lbv $v03.e0, 0x00,s0
        vmadl $v02, $v08, $v08.q1;                ldv $v04.e0, 0x10,s0
        vmacf $v10, $v03.e1;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vmacf");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v03");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 20, 3, 27),
    );
  });

  it("should pick maximum stall cycles for a double stall condition", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vmrg $v01, $v07, $v07.q1;                 lbv $v03.e0, 0x00,s0
        vmadl $v02, $v08, $v08.q1;                ldv $v04.e0, 0x10,s0
        sqv $v03, 0(s1); # HERE there are two stalls: one is for store after load, the other is for write latency`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "sqv");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v03");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 12, 3, 16),
    );
  });

  it("should not dual issue with bnez", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        or t3, t4;                          vlt $v06, $v06, $v07;
        cfc2 t0, COP2_CTRL_VCC;             vmrg $v01, $v01, $v02;
        andi t1, t3, 0x3F00;                vxor $v28, $v28
        bnez t1, Label;                     vge $v10, $v06, $v08;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 0);
  });

  it("should not dual issue in branch delay slot", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `


        bnez t1, Label;                 vge $v10, $v06, $v08;
        andi t3, 0xFF;                  vmrg $v05, $v01, $v03;
        andi t6, 0x38;                  vlt $v06, $v06, $v08;
        cfc2 t1, COP2_CTRL_VCC;         vmrg $v01, $v01, $v03;

        xori t3, 0xFF;                  vge $v08, $v09, $v10;
        or a0, t6;                      vmrg $v03, $v04, $v10;
        ssv $v06.e0, 6,s3;              vlt $v07, $v09, $v10;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 8);

    assert.strictEqual(result.stalledStatements.length, 0);
  });

  it("should catch a double stall", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw s0, %lo(_) + 4
        lw t1, %lo(_) + 0
        sw s0, %lo(_) + 0`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);

    assert.strictEqual(result.stalledStatements[0].statement.op, "sw");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.DOUBLE_STALL,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$s0");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(3, 11, 3, 13),
    );
  });

  it("should force the pair into store after load", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        vsubc $v02, $v10, $v11
        vsubc $v03, $v10, $v11
        vnop
        vnop;                       lw t1, 0(s0)
        vlt $v02, $v02, $v03;
                                    sw t0, 0(s0)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 7);

    assert.strictEqual(result.stalledStatements.length, 2);

    assert.strictEqual(result.stalledStatements[0].statement.op, "vlt");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 1);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v03");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(5, 24, 5, 28),
    );

    assert.strictEqual(result.stalledStatements[1].statement.op, "sw");
    assert.strictEqual(
      result.stalledStatements[1].info.reason,
      StallReason.STORE_AFTER_LOAD,
    );
    assert.strictEqual(result.stalledStatements[1].info.cycles, 1);
    assert.deepStrictEqual(
      result.stalledStatements[1].statement.range,
      new vscode.Range(6, 36, 6, 38),
    );
  });
});
