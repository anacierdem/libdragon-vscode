import * as assert from "assert";
import * as vscode from "vscode";

import { getStalls, loadGrammar } from "./extension";
import { IGrammar } from "vscode-textmate";
import { StallReason } from "./analyze";

describe("Basic stall scenarios", () => {
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

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "vlt");
    assert.strictEqual(stalls[0].info.reason, StallReason.WRITE_LATENCY);
    assert.strictEqual(stalls[0].info.cycles, 3);
    assert.strictEqual(stalls[0].info.reg, "$v02");
    assert.deepStrictEqual(
      stalls[0].statement.range,
      new vscode.Range(2, 8, 2, 11),
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

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 0);
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

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 0);
  });

  it("should create correct stall for a shorthand SU inst. reading a loaded value", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)    # Writes to t0
        sll t0, 2       # Reads from t0 => STALL (2 cycles)`,
    });

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "sll");
    assert.strictEqual(stalls[0].info.reason, StallReason.WRITE_LATENCY);
    assert.strictEqual(stalls[0].info.cycles, 2);
    assert.strictEqual(stalls[0].info.reg, "$t0");
    assert.deepStrictEqual(
      stalls[0].statement.range,
      new vscode.Range(2, 8, 2, 11),
    );
  });

  it("should create correct stall for a full SU inst. reading a loaded value", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)    # Writes to t0
        nop
        sub t1, t0, 2   # Reads from t0 => STALL (1 cycle)`,
    });

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "sub");
    assert.strictEqual(stalls[0].info.reason, StallReason.WRITE_LATENCY);
    assert.strictEqual(stalls[0].info.cycles, 1);
    assert.strictEqual(stalls[0].info.reg, "$t0");
    assert.deepStrictEqual(
      stalls[0].statement.range,
      new vscode.Range(3, 8, 3, 11),
    );
  });

  it("should create correct stall for a shorthand VU inst. reading a loaded value", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lpv $v00, 0(s0)      # Writes to $v00
        vaddc $v00, $v01     # Reads from $v00 => STALL (3 cycles)`,
    });

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "vaddc");
    assert.strictEqual(stalls[0].info.reason, StallReason.WRITE_LATENCY);
    assert.strictEqual(stalls[0].info.cycles, 3);
    assert.strictEqual(stalls[0].info.reg, "$v00");
    assert.deepStrictEqual(
      stalls[0].statement.range,
      new vscode.Range(2, 8, 2, 13),
    );
  });

  it("should create correct stall for a store after load when the delay is 2 cycles", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        lw t0, 0(s0)
        nop
        sqv $v04, 0(s1)    # STALL: write happening two cycles after load`,
    });

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "sqv");
    assert.strictEqual(stalls[0].info.reason, StallReason.STORE_AFTER_LOAD);
    assert.strictEqual(stalls[0].info.cycles, 1);
    assert.strictEqual(stalls[0].info.reg, undefined);
    assert.deepStrictEqual(
      stalls[0].statement.range,
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

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "mtc0");
    assert.strictEqual(stalls[0].info.reason, StallReason.STORE_AFTER_LOAD);
    assert.strictEqual(stalls[0].info.cycles, 1);
    assert.strictEqual(stalls[0].info.reg, undefined);
    assert.deepStrictEqual(
      stalls[0].statement.range,
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

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "mfc0");
    assert.strictEqual(stalls[0].info.reason, StallReason.STORE_AFTER_LOAD);
    assert.strictEqual(stalls[0].info.cycles, 1);
    assert.strictEqual(stalls[0].info.reg, undefined);
    assert.deepStrictEqual(
      stalls[0].statement.range,
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

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "sw");
    assert.strictEqual(stalls[0].info.reason, StallReason.STORE_AFTER_LOAD);
    assert.strictEqual(stalls[0].info.cycles, 1);
    assert.strictEqual(stalls[0].info.reg, undefined);
    assert.deepStrictEqual(
      stalls[0].statement.range,
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

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "cfc2");
    assert.strictEqual(stalls[0].info.reason, StallReason.STORE_AFTER_LOAD);
    assert.strictEqual(stalls[0].info.cycles, 1);
    assert.strictEqual(stalls[0].info.reg, undefined);
    assert.deepStrictEqual(
      stalls[0].statement.range,
      new vscode.Range(3, 8, 3, 12),
    );
  });
});

describe.only("Stall detection with macro expansion", () => {
  let grammar: IGrammar;
  before(async () => {
    grammar = await loadGrammar();
  });

  it("should create 1 cycle stall for a dual issued assembly listing", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        #define v_out_l       $v01
        #define v_out_r       $v02
        #define v_sample_0    $v03
        #define v_sample_1    $v04
        #define v_sample_2    $v05
        #define v_sample_3    $v06
        #define v_mix_l       $v07
        #define v_mix_r       $v08

      Mix32Loop:
        # Mix all lanes together into the first lane       # Load next loop's samples
        vaddc v_out_l, v_mix_l, v_mix_l.q1;                lqv v_sample_0.e0, 0x00,s0
        vaddc v_out_r, v_mix_r, v_mix_r.q1;                lqv v_sample_1.e0, 0x10,s0
          # 1 cycle stall here
        vaddc v_out_l, v_out_l, v_out_l.h2;                lqv v_sample_2.e0, 0x20,s0`,
    });

    const stalls = await getStalls(document, grammar);
    assert.strictEqual(stalls.length, 1);
    assert.strictEqual(stalls[0].statement.op, "vaddc");
    assert.strictEqual(stalls[0].info.reason, StallReason.WRITE_LATENCY);
    assert.strictEqual(stalls[0].info.cycles, 2);
    assert.strictEqual(stalls[0].info.reg, "$v01");
    assert.deepStrictEqual(
      stalls[0].statement.range,
      new vscode.Range(15, 8, 15, 12),
    );
  });
});
