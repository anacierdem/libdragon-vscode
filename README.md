# Libdragon

A vscode extension to simplify development with `libdragon`.

# Features

## RSP and MIPS assembly highlighting

You can enable this feature by installing this extension. You may additionally need to disable other extensions targeting mips assembly files. Currently the extension can discriminate libdragon RSP files and mark unimplemented instructions. It also provides good MIPS highlighting out of the box as the language spec. is implemented as a text mate grammar to be as accurate and useful as possilbe.

## RSP MIPS assembly stall detection

The extension will show the pipeline stalls caused by write latency and store after load. Dual issue rules except for the hardware bug, 8-byte alignment on branch target and control register interactions are implemented. See the [wiki](https://n64brew.dev/wiki/Reality_Signal_Processor/CPU_Pipeline) for further information. Macro expansion is limited to simple name aliasing and doesn't support multi-line statements. It doesn't support function-like macros either. On the status bar, the extension will display the total instruction and stall count in the currently open file.

## Installation

run;

    code --install-extension lici.libdragon-vscode

in your command line, assuming vscode is installed and registered in your path.


# TODO:

- [ ] Status bar should show counts for the selection/the function that the cursor is in.
- [ ] Implement preview for libdragon sprites
- [ ] Add more descriptive highlighting for known as directives
- [ ] Implement semantic MIPS assembly highlighting. Current version is all static