# Libdragon

A vscode extension to simplify development with `libdragon`.

# Features

## RSP and MIPS assembly highlighting

You can enable this feature by installing this extension. You may additionally need to disable other extensions targeting mips assembly files. Currently the extension can discriminate libdragon RSP files and mark unimplemented instructions. It also provides good MIPS highlighting out of the box as the language spec. is implemented as a text mate grammar to be as .

# TODO:

- [ ] Enable semantic versioning
- [ ] RSP MIPS assembly pipeline stall detection
- [ ] Implement preview for libdragon sprites
- [ ] Extend syntax highlighting to also cover regular MIPS assembly files
- [ ] Add more descriptive highlighting for known as directives
- [ ] Better handling of C preprocessor directives for MIPS assembly highlighting
- [ ] Implement semantic MIPS assembly highlighting. Current version is all static