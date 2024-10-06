import * as assert from "assert";
import * as vscode from "vscode";

import { analyzeStalls, loadGrammar } from "./extension";
import { IGrammar } from "vscode-textmate";
import { StallReason } from "./analyze";

describe("getStalls", () => {
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
        lpv $v00, 0(s0)      # Writes to $v00
        vaddc $v00, $v01     # Reads from $v00 => STALL (3 cycles)`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vaddc");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 3);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v00");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(2, 14, 2, 18),
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

  const mixerDefines = `
    #define v_out_l       $v01
    #define v_out_r       $v02
    #define v_sample_0    $v03
    #define v_sample_1    $v04
    #define v_sample_2    $v05
    #define v_sample_3    $v06
    #define v_mix_l       $v07
    #define v_mix_r       $v08`;

  it("should create 1 cycle stall for a dual issued assembly listing", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
      ${mixerDefines}

      Mix32Loop:
        # Mix all lanes together into the first lane       # Load next loop's samples
        vaddc v_out_l, v_mix_l, v_mix_l.q1;                lqv v_sample_0.e0, 0x00,s0
        vaddc v_out_r, v_mix_r, v_mix_r.q1;                lsv v_sample_1.e0, 0x10,s0
        vaddc v_out_l, v_out_l, v_out_l.h2;                lqv v_sample_2.e0, 0x20,s0`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vaddc");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v01");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(15, 23, 15, 30),
    );
  });

  it("should create 1 cycle stall without .eN syntax for 3 operand vector inst.", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
      ${mixerDefines}

      Mix32Loop:
        vaddc v_out_l, v_mix_l, v_mix_l.q1;                lpv v_sample_0.e0, 0x00,s0
        vaddc v_out_r, v_mix_r, v_mix_r.q1;                luv v_sample_1.e0, 0x10,s0
        vaddc v_out_l, v_out_l, 3;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 1);
    assert.strictEqual(result.stalledStatements[0].statement.op, "vaddc");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v01");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(14, 23, 14, 30),
    );
  });

  it("should keep track of a current target's state while executing the last stall", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
      ${mixerDefines}

      vmacf v_mix_r, v_sample_3, v_xvol_r_3;

      vaddc v_out_l, v_mix_l, v_mix_l.q1;                lqv v_sample_0.e0, 0x00,s0
      vaddc v_out_r, v_mix_r, v_mix_r.q1;                lqv v_sample_1.e0, 0x10,s0
      vaddc v_out_l, v_out_l, v_out_l.h2;                lqv v_sample_2.e0, 0x20,s0
      vaddc v_out_r, v_out_r, v_out_r.h2;                lqv v_sample_3.e0, 0x30,s0
      vaddc v_out_l, v_out_l, v_out_l.e4;                bnez t0, Mix32Loop
      vaddc v_out_r, v_out_r, v_out_r.e4;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 13);

    assert.strictEqual(result.stalledStatements.length, 3);

    assert.strictEqual(result.stalledStatements[0].statement.op, "vaddc");
    assert.strictEqual(
      result.stalledStatements[0].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[0].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[0].info.reg, "$v08");
    assert.deepStrictEqual(
      result.stalledStatements[0].info.operand.range,
      new vscode.Range(14, 21, 14, 28),
    );

    assert.strictEqual(result.stalledStatements[1].statement.op, "vaddc");
    assert.strictEqual(
      result.stalledStatements[1].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[1].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[1].info.reg, "$v02");
    assert.deepStrictEqual(
      result.stalledStatements[1].info.operand.range,
      new vscode.Range(16, 21, 16, 28),
    );

    assert.strictEqual(result.stalledStatements[2].statement.op, "vaddc");
    assert.strictEqual(
      result.stalledStatements[2].info.reason,
      StallReason.WRITE_LATENCY,
    );
    assert.strictEqual(result.stalledStatements[2].info.cycles, 2);
    assert.strictEqual(result.stalledStatements[2].info.reg, "$v02");
    assert.deepStrictEqual(
      result.stalledStatements[2].info.operand.range,
      new vscode.Range(18, 21, 18, 28),
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

  const triDefines = `
    #define tricmd a0
    #define vtx1   RDPQ_TRIANGLE_VTX1   // a1
    #define vtx2   RDPQ_TRIANGLE_VTX2   // a2
    #define vtx3   RDPQ_TRIANGLE_VTX3   // a3
    #define cull   v0

    #define vfinal_i         $v01
    #define vfinal_f         $v02
    #define vdx_i            $v03
    #define vdx_f            $v04
    #define vde_i            $v05
    #define vde_f            $v06
    #define vdy_i            $v07
    #define vdy_f            $v08

    #define vattr1           $v09
    #define vattr2           $v10
    #define vattr3           $v11
    #define attr1_r     vattr1.e0
    #define attr2_r     vattr2.e0
    #define attr3_r     vattr3.e0
    #define attr1_s     vattr1.e4
    #define attr2_s     vattr2.e4
    #define attr3_s     vattr3.e4
    #define attr1_invw  vattr1.e6
    #define attr2_invw  vattr2.e6
    #define attr3_invw  vattr3.e6
    #define attr1_z     vattr1.e7
    #define attr2_z     vattr2.e7
    #define attr3_z     vattr3.e7
    #define vma              $v12
    #define vha              $v13

    #define vw_i             $v07
    #define vw_f             $v08

    #define vinvw_i          $v14
    #define vinvw_f          $v15

    #define vedges_i         $v16
    #define vedges_f         $v17
    #define vnz_i            $v18
    #define vnz_f            $v19
    #define vslope_i         $v20
    #define vslope_f         $v21
    #define vx12_i           $v22
    #define vx12_f           $v23

    #define vhml             $v24
    #define vfy_i            $v25
    #define vfy_f            $v26

    #define vmconst          $v27
    #define VKM1             vmconst.e7
    #define VKM4             vmconst.e5

    #define vtmp             $v28
    #define v__              $v29
    #define invn_i           $v31.e4
    #define invn_f           $v31.e5
    #define invsh_i          $v31.e6
    #define invsh_f          $v31.e7


    #define vall1    $v01
    #define vall2    $v02
    #define vall3    $v03
    #define valltmp1 $v04
    #define valltmp2 $v05
    #define vy1      $v06
    #define vy2      $v07
    #define vy3      $v08
    #define vytmp1   $v09
    #define vytmp2   $v10

    #define vm      valltmp2
    #define vl      valltmp1
    #define hx      vhml.e0
    #define hy      vhml.e1
    #define mx      vm.e0
    #define my      vm.e1
    #define lx      vl.e0
    #define ly      vl.e1
    #define vhmlupp vtmp

    #define vk1     $v12

    #define vstall
    #define stall

    #define clip1  t3
    #define clip2  t4
    #define clip3  t5
    #define did_swap_0     t0
    #define did_swap_1     t1
    #define did_swap_2     t2`;

  it("should not dual issue with bnez", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        ${triDefines}

        or clip1, clip2;                            vlt vy1, vy1, vy2;                  
        cfc2 did_swap_0, COP2_CTRL_VCC;             vmrg vall1, vall1, vall2;

        andi t1, clip1, 0x3F00;                     vxor vhmlupp, vhmlupp

        bnez t1, RDPQ_Triangle_Clip;                vge vytmp2, vy1, vy3;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 5);

    assert.strictEqual(result.stalledStatements.length, 0);
  });

  it("should not dual issue in branch delay slot", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: `
        ${triDefines}

        bnez t1, RDPQ_Triangle_Clip;                vge vytmp2, vy3, vy3;
        andi clip1, 0xFF;                           vmrg valltmp2, vdall1, vall3;
        andi t6, 0x38;                              vlt vy1, vy1, vy3;                  
        cfc2 did_swap_1, COP2_CTRL_VCC;             vmrg vall1, vall1, vall3;           

        xori clip1, 0xFF;                           vge vy3, vytmp1, vytmp2;            
        or tricmd, t6;                              vmrg vall3, valltmp1, valltmp2;
        ssv vy1.e0, 6,s3;                           vlt vy2, vytmp1, vytmp2;`,
    });

    const result = await analyzeStalls(document, grammar);
    assert.strictEqual(result.totalTicks, 8);

    assert.strictEqual(result.stalledStatements.length, 0);
  });
});
