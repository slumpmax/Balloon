'use strict';

// 6502 (NES) opcode table.
// mode: imp acc imm zp zpx zpy abs absx absy ind izx izy rel
const MODE_SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, absx: 3, absy: 3, ind: 3 };

// base cycles (page-cross/taken-branch penalties ignored by our runtimes)
const INFO = {};

function def(op, mnem, mode, cyc) {
  INFO[op] = { mnem, mode, cyc };
}

// ---- official ----
def(0x00, 'BRK', 'imp', 7);
def(0x01, 'ORA', 'izx', 6);
def(0x05, 'ORA', 'zp', 3);
def(0x06, 'ASL', 'zp', 5);
def(0x08, 'PHP', 'imp', 3);
def(0x09, 'ORA', 'imm', 2);
def(0x0A, 'ASL', 'acc', 2);
def(0x0D, 'ORA', 'abs', 4);
def(0x0E, 'ASL', 'abs', 6);
def(0x10, 'BPL', 'rel', 2);
def(0x11, 'ORA', 'izy', 5);
def(0x15, 'ORA', 'zpx', 4);
def(0x16, 'ASL', 'zpx', 6);
def(0x18, 'CLC', 'imp', 2);
def(0x19, 'ORA', 'absy', 4);
def(0x1D, 'ORA', 'absx', 4);
def(0x1E, 'ASL', 'absx', 7);
def(0x20, 'JSR', 'abs', 6);
def(0x21, 'AND', 'izx', 6);
def(0x24, 'BIT', 'zp', 3);
def(0x25, 'AND', 'zp', 3);
def(0x26, 'ROL', 'zp', 5);
def(0x28, 'PLP', 'imp', 4);
def(0x29, 'AND', 'imm', 2);
def(0x2A, 'ROL', 'acc', 2);
def(0x2C, 'BIT', 'abs', 4);
def(0x2D, 'AND', 'abs', 4);
def(0x2E, 'ROL', 'abs', 6);
def(0x30, 'BMI', 'rel', 2);
def(0x31, 'AND', 'izy', 5);
def(0x35, 'AND', 'zpx', 4);
def(0x36, 'ROL', 'zpx', 6);
def(0x38, 'SEC', 'imp', 2);
def(0x39, 'AND', 'absy', 4);
def(0x3D, 'AND', 'absx', 4);
def(0x3E, 'ROL', 'absx', 7);
def(0x40, 'RTI', 'imp', 6);
def(0x41, 'EOR', 'izx', 6);
def(0x45, 'EOR', 'zp', 3);
def(0x46, 'LSR', 'zp', 5);
def(0x48, 'PHA', 'imp', 3);
def(0x49, 'EOR', 'imm', 2);
def(0x4A, 'LSR', 'acc', 2);
def(0x4C, 'JMP', 'abs', 3);
def(0x4D, 'EOR', 'abs', 4);
def(0x4E, 'LSR', 'abs', 6);
def(0x50, 'BVC', 'rel', 2);
def(0x51, 'EOR', 'izy', 5);
def(0x55, 'EOR', 'zpx', 4);
def(0x56, 'LSR', 'zpx', 6);
def(0x58, 'CLI', 'imp', 2);
def(0x59, 'EOR', 'absy', 4);
def(0x5D, 'EOR', 'absx', 4);
def(0x5E, 'LSR', 'absx', 7);
def(0x60, 'RTS', 'imp', 6);
def(0x61, 'ADC', 'izx', 6);
def(0x65, 'ADC', 'zp', 3);
def(0x66, 'ROR', 'zp', 5);
def(0x68, 'PLA', 'imp', 4);
def(0x69, 'ADC', 'imm', 2);
def(0x6A, 'ROR', 'acc', 2);
def(0x6C, 'JMP', 'ind', 5);
def(0x6D, 'ADC', 'abs', 4);
def(0x6E, 'ROR', 'abs', 6);
def(0x70, 'BVS', 'rel', 2);
def(0x71, 'ADC', 'izy', 5);
def(0x75, 'ADC', 'zpx', 4);
def(0x76, 'ROR', 'zpx', 6);
def(0x78, 'SEI', 'imp', 2);
def(0x79, 'ADC', 'absy', 4);
def(0x7D, 'ADC', 'absx', 4);
def(0x7E, 'ROR', 'absx', 7);
def(0x81, 'STA', 'izx', 6);
def(0x84, 'STY', 'zp', 3);
def(0x85, 'STA', 'zp', 3);
def(0x86, 'STX', 'zp', 3);
def(0x88, 'DEY', 'imp', 2);
def(0x8A, 'TXA', 'imp', 2);
def(0x8C, 'STY', 'abs', 4);
def(0x8D, 'STA', 'abs', 4);
def(0x8E, 'STX', 'abs', 4);
def(0x90, 'BCC', 'rel', 2);
def(0x91, 'STA', 'izy', 6);
def(0x94, 'STY', 'zpx', 4);
def(0x95, 'STA', 'zpx', 4);
def(0x96, 'STX', 'zpy', 4);
def(0x98, 'TYA', 'imp', 2);
def(0x99, 'STA', 'absy', 5);
def(0x9A, 'TXS', 'imp', 2);
def(0x9D, 'STA', 'absx', 5);
def(0xA0, 'LDY', 'imm', 2);
def(0xA1, 'LDA', 'izx', 6);
def(0xA2, 'LDX', 'imm', 2);
def(0xA4, 'LDY', 'zp', 3);
def(0xA5, 'LDA', 'zp', 3);
def(0xA6, 'LDX', 'zp', 3);
def(0xA8, 'TAY', 'imp', 2);
def(0xA9, 'LDA', 'imm', 2);
def(0xAA, 'TAX', 'imp', 2);
def(0xAC, 'LDY', 'abs', 4);
def(0xAD, 'LDA', 'abs', 4);
def(0xAE, 'LDX', 'abs', 4);
def(0xB0, 'BCS', 'rel', 2);
def(0xB1, 'LDA', 'izy', 5);
def(0xB4, 'LDY', 'zpx', 4);
def(0xB5, 'LDA', 'zpx', 4);
def(0xB6, 'LDX', 'zpy', 4);
def(0xB8, 'CLV', 'imp', 2);
def(0xB9, 'LDA', 'absy', 4);
def(0xBA, 'TSX', 'imp', 2);
def(0xBC, 'LDY', 'absx', 4);
def(0xBD, 'LDA', 'absx', 4);
def(0xBE, 'LDX', 'absy', 4);
def(0xC0, 'CPY', 'imm', 2);
def(0xC1, 'CMP', 'izx', 6);
def(0xC4, 'CPY', 'zp', 3);
def(0xC5, 'CMP', 'zp', 3);
def(0xC6, 'DEC', 'zp', 5);
def(0xC8, 'INY', 'imp', 2);
def(0xC9, 'CMP', 'imm', 2);
def(0xCA, 'DEX', 'imp', 2);
def(0xCC, 'CPY', 'abs', 4);
def(0xCD, 'CMP', 'abs', 4);
def(0xCE, 'DEC', 'abs', 6);
def(0xD0, 'BNE', 'rel', 2);
def(0xD1, 'CMP', 'izy', 5);
def(0xD5, 'CMP', 'zpx', 4);
def(0xD6, 'DEC', 'zpx', 6);
def(0xD8, 'CLD', 'imp', 2);
def(0xD9, 'CMP', 'absy', 4);
def(0xDD, 'CMP', 'absx', 4);
def(0xDE, 'DEC', 'absx', 7);
def(0xE0, 'CPX', 'imm', 2);
def(0xE1, 'SBC', 'izx', 6);
def(0xE4, 'CPX', 'zp', 3);
def(0xE5, 'SBC', 'zp', 3);
def(0xE6, 'INC', 'zp', 5);
def(0xE8, 'INX', 'imp', 2);
def(0xE9, 'SBC', 'imm', 2);
def(0xEA, 'NOP', 'imp', 2);
def(0xEC, 'CPX', 'abs', 4);
def(0xED, 'SBC', 'abs', 4);
def(0xEE, 'INC', 'abs', 6);
def(0xF0, 'BEQ', 'rel', 2);
def(0xF1, 'SBC', 'izy', 5);
def(0xF5, 'SBC', 'zpx', 4);
def(0xF6, 'INC', 'zpx', 6);
def(0xF8, 'SED', 'imp', 2);
def(0xF9, 'SBC', 'absy', 4);
def(0xFD, 'SBC', 'absx', 4);
def(0xFE, 'INC', 'absx', 7);

// ---- unofficial / extended (implemented best-effort) ----
// multi-byte NOPs (treated as NOP with operand bytes)
const NOP2 = { mnem: 'NOP', mode: 'zp', cyc: 2 };
const NOP3 = { mnem: 'NOP', mode: 'abs', cyc: 3 };
for (const op of [0x04, 0x44, 0x64, 0x1A, 0x3A, 0x5A, 0x7A, 0xDA, 0xFA, 0x80, 0x82]) def(op, 'NOP', 'zp', 2);
for (const op of [0x89]) def(op, 'NOP', 'imm', 2);
for (const op of [0x0C, 0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC]) def(op, 'NOP', 'abs', 3);
def(0x14, 'NOP', 'zpx', 2);
def(0x34, 'NOP', 'zpx', 2);
def(0x54, 'NOP', 'zpx', 2);
def(0x74, 'NOP', 'zpx', 2);
def(0xD4, 'NOP', 'zpx', 2);
def(0xF4, 'NOP', 'zpx', 2);

// LAX (LDA+LDX)
def(0xA7, 'LAX', 'zp', 3);
def(0xB7, 'LAX', 'zpy', 4);
def(0xAF, 'LAX', 'abs', 4);
def(0xBF, 'LAX', 'absy', 4);
def(0xA3, 'LAX', 'izx', 6);
def(0xB3, 'LAX', 'izy', 5);
def(0xAB, 'LAX', 'imm', 2);

// SAX (STA&STX)
def(0x87, 'SAX', 'zp', 3);
def(0x97, 'SAX', 'zpy', 4);
def(0x8F, 'SAX', 'abs', 4);
def(0x83, 'SAX', 'izx', 6);

// DCP (CMP+DEC)
def(0xC7, 'DCP', 'zp', 5);
def(0xD7, 'DCP', 'zpx', 6);
def(0xCF, 'DCP', 'abs', 6);
def(0xDB, 'DCP', 'absy', 7);
def(0xC3, 'DCP', 'izx', 8);
def(0xD3, 'DCP', 'izy', 8);

// ISB/ISC (INC+SBC)
def(0xE7, 'ISB', 'zp', 5);
def(0xF7, 'ISB', 'zpx', 6);
def(0xEF, 'ISB', 'abs', 6);
def(0xFB, 'ISB', 'absy', 7);
def(0xE3, 'ISB', 'izx', 8);
def(0xF3, 'ISB', 'izy', 8);

// SLO (ASL+ORA)
def(0x07, 'SLO', 'zp', 5);
def(0x17, 'SLO', 'zpx', 6);
def(0x0F, 'SLO', 'abs', 6);
def(0x1B, 'SLO', 'absy', 7);
def(0x03, 'SLO', 'izx', 8);
def(0x13, 'SLO', 'izy', 8);

// RLA (ROL+AND)
def(0x27, 'RLA', 'zp', 5);
def(0x37, 'RLA', 'zpx', 6);
def(0x2F, 'RLA', 'abs', 6);
def(0x3B, 'RLA', 'absy', 7);
def(0x23, 'RLA', 'izx', 8);
def(0x33, 'RLA', 'izy', 8);

// SRE (LSR+EOR)
def(0x47, 'SRE', 'zp', 5);
def(0x57, 'SRE', 'zpx', 6);
def(0x4F, 'SRE', 'abs', 6);
def(0x5B, 'SRE', 'absy', 7);
def(0x43, 'SRE', 'izx', 8);
def(0x53, 'SRE', 'izy', 8);

// RRA (ROR+ADC)
def(0x67, 'RRA', 'zp', 5);
def(0x77, 'RRA', 'zpx', 6);
def(0x6F, 'RRA', 'abs', 6);
def(0x7B, 'RRA', 'absy', 7);
def(0x63, 'RRA', 'izx', 8);
def(0x73, 'RRA', 'izy', 8);

// ANC/ALR/ARR/AXS (immediate-only)
def(0x0B, 'ANC', 'imm', 2);
def(0x2B, 'ANC', 'imm', 2);
def(0x4B, 'ALR', 'imm', 2);
def(0x6B, 'ARR', 'imm', 2);
def(0xCB, 'AXS', 'imm', 2);
def(0xBB, 'LAS', 'absy', 4);

// catch-all unknown: harmless 2-byte NOP
function known(op) { return INFO[op] !== undefined; }
for (let op = 0; op < 256; op++) {
  if (!known(op)) def(op, 'NOP', 'zp', 2);
}

module.exports = { INFO, MODE_SIZE };