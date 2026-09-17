'use strict';

const fs = require('fs');
const path = require('path');
const { INFO, MODE_SIZE } = require('./opcodes.cjs');

const OUT_DIR = process.argv[2] || path.join(__dirname, '..', 'public', 'game');

// ---------------------------------------------------------------- helpers
function hex4(n) { return '0x' + n.toString(16).padStart(4, '0'); }
function hex2(n) { return '0x' + n.toString(16).padStart(2, '0'); }

function parseINes(buf) {
  if (buf.length < 16 || buf[0] !== 0x4E || buf[1] !== 0x45 || buf[2] !== 0x53 || buf[3] !== 0x1A) {
    throw new Error('Not a valid iNES file');
  }
  const prgBanks = buf[4];
  const chrBanks = buf[5];
  const hasTrainer = (buf[6] & 0x04) !== 0;
  const mapper = (buf[6] >> 4) | (buf[7] & 0xF0);
  const mirrorVertical = (buf[6] & 0x01) !== 0;
  let off = 16 + (hasTrainer ? 512 : 0);
  const prgLen = prgBanks * 0x4000;
  const chrLen = chrBanks * 0x2000;
  return {
    prg: buf.slice(off, off + prgLen),
    chr: buf.slice(off + prgLen, off + prgLen + chrLen),
    mapper, mirrorVertical, prgBanks, chrBanks,
  };
}

function readU8(prg, addr) {
  addr &= 0xFFFF;
  const half = (addr >= 0xC000) ? (prg.length > 0x4000 ? 1 : 0) : 0;
  const v = prg[(addr & 0x3FFF) + half * 0x4000];
  return v === undefined ? 0 : v;
}
function readU16(prg, addr) { return readU8(prg, addr) | (readU8(prg, addr + 1) << 8); }

// ---------------------------------------------------------------- disasm + scan
function opName(mode, b1, w) {
  const h1 = hex2(b1);
  const h2 = hex2(b1 | ((w >> 8) & 0xFF) << 8).slice(2);
  switch (mode) {
    case 'imp': case 'acc': return '';
    case 'imm': return '#$' + h1.slice(2).toUpperCase();
    case 'zp': return '$' + h1.slice(2).toUpperCase();
    case 'zpx': return '$' + h1.slice(2).toUpperCase() + ',X';
    case 'zpy': return '$' + h1.slice(2).toUpperCase() + ',Y';
    case 'abs': return '$' + hex4(w).slice(2).toUpperCase();
    case 'absx': return '$' + hex4(w).slice(2).toUpperCase() + ',X';
    case 'absy': return '$' + hex4(w).slice(2).toUpperCase() + ',Y';
    case 'ind': return '($' + hex4(w).slice(2).toUpperCase() + ')';
    case 'izx': return '($' + h1.slice(2).toUpperCase() + ',X)';
    case 'izy': return '($' + h1.slice(2).toUpperCase() + '),Y';
    case 'rel': return '$' + hex4(w).slice(2).toUpperCase();
  }
  return '';
}

function scanROM(prg) {
  /* อ่านเฉพาะ vectors — ตัว emit ใช้ "ทุก address = 1 instruction" แล้ว จึงไม่ต้อง flow-scan */
  return {
    reset: readU16(prg, 0xFFFC),
    nmi: readU16(prg, 0xFFFA),
    irq: readU16(prg, 0xFFFE),
  };
}

// ---------------------------------------------------------------- code emitter
function buildAddressExpr(mode, b1, w) {
  switch (mode) {
    case 'zp': return hex2(b1);
    case 'zpx': return '(' + hex2(b1) + '+R.X)&0xFF';
    case 'zpy': return '(' + hex2(b1) + '+R.Y)&0xFF';
    case 'abs': return hex4(w);
    case 'absx': return '(' + hex4(w) + '+R.X)&0xFFFF';
    case 'absy': return '(' + hex4(w) + '+R.Y)&0xFFFF';
    case 'izx':
      return 'T(R.r8((' + hex2(b1) + '+R.X)&0xFF)|(R.r8(((' + hex2(b1) + '+R.X)&0xFF+1)&0xFF)<<8))&0xFFFF';
    case 'izy':
      return 'T((R.r8(' + hex2(b1) + ')|(R.r8(' + hex2((b1 + 1) & 0xFF) + ')<<8))+R.Y)&0xFFFF';
    case 'ind':
      return 'T(R.r8(' + hex4(w) + ')|(R.r8((' + hex4(w) + '+1)&0xFFFF)<<8))';
    case 'acc': return 'acc';
    default: return null;
  }
}

function valueExpr(mode, b1, e) {
  if (mode === 'imm') return hex2(b1);
  if (mode === 'acc') return 'R.A';
  return 'R.r8(' + e + ')';
}

// eslint-disable-next-line complexity
function emitInstruction(mnem, mode, cyc, pc0, b1, w) {
  const L = [];
  const PC_SETS = { JMP: 1, JSR: 1, RTS: 1, RTI: 1, BRK: 1, BPL: 1, BMI: 1, BVC: 1, BVS: 1, BCC: 1, BCS: 1, BNE: 1, BEQ: 1 };
  const E = buildAddressExpr(mode, b1, w);
  let e = E;
  if (E && E[0] === 'T') {
    const expr = 't=' + E.slice(1);
    L.push(expr);
    e = 't';
  }
  const V = valueExpr(mode, b1, e);
  const useMem = mode !== 'imm' && mode !== 'acc' && mode !== 'imp';

  switch (mnem) {
    case 'LDA': L.push('R.A=' + V + ';R.setZN(R.A)'); break;
    case 'LDX': L.push('R.X=' + V + ';R.setZN(R.X)'); break;
    case 'LDY': L.push('R.Y=' + V + ';R.setZN(R.Y)'); break;
    case 'LAX': L.push('R.A=' + V + ';R.X=R.A;R.setZN(R.A)'); break;
    case 'STA': L.push('R.w8(' + e + ',R.A)'); break;
    case 'STX': L.push('R.w8(' + e + ',R.X)'); break;
    case 'STY': L.push('R.w8(' + e + ',R.Y)'); break;
    case 'SAX': L.push('R.w8(' + e + ',(R.A&R.X)&0xFF)'); break;

    case 'ORA': L.push('R.A|=(' + V + ')&0xFF;R.setZN(R.A)'); break;
    case 'AND': L.push('R.A&=' + V + ';R.setZN(R.A)'); break;
    case 'EOR': L.push('R.A^=' + V + ';R.setZN(R.A)'); break;

    case 'ADC': {
      const m = useMem ? V : hex2(b1);
      L.push('t=' + m + ';const s=R.A+t+(R.P&1);const r=s&0xFF;R.P=(R.P&~0xC1)|(s>255?1:0)|(((R.A^r)&(t^r)&0x80)!==0?0x40:0);R.A=r;R.setZN(r)');
      break;
    }
    case 'SBC': {
      const m = useMem ? V : hex2(b1);
      L.push('t=' + m + ';const s=R.A-t-(1-(R.P&1));const r=s&0xFF;R.P=(R.P&~0xC1)|(s>=0?1:0)|(((R.A^r)&((t^0xFF)^r)&0x80)!==0?0x40:0);R.A=r;R.setZN(r)');
      break;
    }
    case 'CMP':
      L.push('t=' + V + ';R.P=(R.P&0xFE)|(R.A>=t?1:0);R.setZN((R.A-t)&0xFF)');
      break;
    case 'CPX':
      L.push('t=' + V + ';R.P=(R.P&0xFE)|(R.X>=t?1:0);R.setZN((R.X-t)&0xFF)');
      break;
    case 'CPY':
      L.push('t=' + V + ';R.P=(R.P&0xFE)|(R.Y>=t?1:0);R.setZN((R.Y-t)&0xFF)');
      break;

    case 'INC': L.push('t=R.r8(' + e + ');t=(t+1)&0xFF;R.w8(' + e + ',t);R.setZN(t)'); break;
    case 'DEC': L.push('t=R.r8(' + e + ');t=(t-1)&0xFF;R.w8(' + e + ',t);R.setZN(t)'); break;
    case 'INX': L.push('R.X=(R.X+1)&0xFF;R.setZN(R.X)'); break;
    case 'INY': L.push('R.Y=(R.Y+1)&0xFF;R.setZN(R.Y)'); break;
    case 'DEX': L.push('R.X=(R.X-1)&0xFF;R.setZN(R.X)'); break;
    case 'DEY': L.push('R.Y=(R.Y-1)&0xFF;R.setZN(R.Y)'); break;

    case 'ASL': {
      if (mode === 'acc') {
        L.push('R.P=(R.P&0xFE)|((R.A>>7)&1);R.A=(R.A<<1)&0xFF;R.setZN(R.A)');
      } else {
        L.push('t=R.r8(' + e + ');R.P=(R.P&0xFE)|((t>>7)&1);t=(t<<1)&0xFF;R.w8(' + e + ',t);R.setZN(t)');
      }
      break;
    }
    case 'LSR': {
      if (mode === 'acc') {
        L.push('R.P=(R.P&0xFE)|(R.A&1);R.A=R.A>>1;R.setZN(R.A)');
      } else {
        L.push('t=R.r8(' + e + ');R.P=(R.P&0xFE)|(t&1);t=t>>1;R.w8(' + e + ',t);R.setZN(t)');
      }
      break;
    }
    case 'ROL': {
      if (mode === 'acc') {
        L.push('t=(R.P&1);R.P=(R.P&0xFE)|((R.A>>7)&1);R.A=((R.A<<1)|t)&0xFF;R.setZN(R.A)');
      } else {
        L.push('t=R.r8(' + e + ');const c=R.P&1;R.P=(R.P&0xFE)|((t>>7)&1);t=((t<<1)|c)&0xFF;R.w8(' + e + ',t);R.setZN(t)');
      }
      break;
    }
    case 'ROR': {
      if (mode === 'acc') {
        L.push('t=(R.P&1)<<7;R.P=(R.P&0xFE)|(R.A&1);R.A=((R.A>>1)|t)&0xFF;R.setZN(R.A)');
      } else {
        L.push('t=R.r8(' + e + ');const c=(R.P&1)<<7;R.P=(R.P&0xFE)|(t&1);t=((t>>1)|c)&0xFF;R.w8(' + e + ',t);R.setZN(t)');
      }
      break;
    }

    case 'BIT':
      L.push('t=' + V + ';R.P=(R.P&0x3D)|(t&0xC0)|(((R.A&t)===0)?0x02:0)');
      break;

    case 'JMP':
      if (mode === 'abs') { L.push('R.PC=' + hex4(w)); } else { L.push('R.PC=t&0xFFFF'); }
      break;
    case 'JSR': {
      const ret = hex2((pc0 + 2) & 0xFF);
      const retH = hex2(((pc0 + 2) >> 8) & 0xFF);
      L.push('R.push8(' + retH + ');R.push8(' + ret + ');R.PC=' + hex4(w));
      break;
    }
    case 'RTS': L.push('t=R.pop16();R.PC=(t+1)&0xFFFF'); break;
    case 'RTI': L.push('R.P=R.pop8();R.PC=R.pop16()'); break;
    case 'BRK': L.push('R.push16((R.PC+1)&0xFFFF);R.push8(R.P|0x30);R.P|=0x04;R.PC=R.r16(0xFFFE)'); break;

    case 'PHA': L.push('R.push8(R.A)'); break;
    case 'PHP': L.push('R.push8(R.P|0x10)'); break;
    case 'PLA': L.push('R.A=R.pop8();R.setZN(R.A)'); break;
    case 'PLP': L.push('R.P=R.pop8()'); break;

    case 'BPL': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x80)===0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }
    case 'BMI': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x80)!==0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }
    case 'BVC': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x40)===0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }
    case 'BVS': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x40)!==0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }
    case 'BCC': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x01)===0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }
    case 'BCS': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x01)!==0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }
    case 'BNE': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x02)===0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }
    case 'BEQ': { const rt = (pc0 + 2 + (b1 << 24 >> 24)) & 0xFFFF; L.push('if((R.P&0x02)!==0){R.PC=' + hex4(rt) + ';}else{R.PC=' + hex4(pc0 + 2) + '}'); break; }

    case 'CLC': L.push('R.P&=0xFE'); break;
    case 'SEC': L.push('R.P|=0x01'); break;
    case 'CLI': L.push('R.P&=0xFB'); break;
    case 'SEI': L.push('R.P|=0x04'); break;
    case 'CLV': L.push('R.P&=0xBF'); break;
    case 'CLD': L.push('R.P&=0xF7'); break;
    case 'SED': L.push('R.P|=0x08'); break;

    case 'TAX': L.push('R.X=R.A;R.setZN(R.X)'); break;
    case 'TAY': L.push('R.Y=R.A;R.setZN(R.Y)'); break;
    case 'TXA': L.push('R.A=R.X;R.setZN(R.A)'); break;
    case 'TYA': L.push('R.A=R.Y;R.setZN(R.A)'); break;
    case 'TSX': L.push('R.X=R.SP;R.setZN(R.X)'); break;
    case 'TXS': L.push('R.SP=R.X'); break;

    // unofficial
    case 'DCP': L.push('t=R.r8(' + e + ');t=(t-1)&0xFF;R.w8(' + e + ',t);R.P=(R.P&0xFE)|(R.A>=t?1:0);R.setZN((R.A-t)&0xFF)'); break;
    case 'ISB': L.push('t=R.r8(' + e + ');t=(t+1)&0xFF;R.w8(' + e + ',t);const s=R.A-t-(1-(R.P&1));const r=s&0xFF;R.P=(R.P&~0xC1)|(s>=0?1:0)|(((R.A^r)&((t^0xFF)^r)&0x80)!==0?0x40:0);R.A=r;R.setZN(r)'); break;
    case 'SLO': L.push('t=R.r8(' + e + ');R.P=(R.P&0xFE)|((t>>7)&1);t=(t<<1)&0xFF;R.w8(' + e + ',t);R.A|=t;R.setZN(R.A)'); break;
    case 'RLA': L.push('t=R.r8(' + e + ');const c=R.P&1;R.P=(R.P&0xFE)|((t>>7)&1);t=((t<<1)|c)&0xFF;R.w8(' + e + ',t);R.A&=t;R.setZN(R.A)'); break;
    case 'SRE': L.push('t=R.r8(' + e + ');R.P=(R.P&0xFE)|(t&1);t=t>>1;R.w8(' + e + ',t);R.A^=t;R.setZN(R.A)'); break;
    case 'RRA': L.push('t=R.r8(' + e + ');const c=(R.P&1)<<7;R.P=(R.P&0xFE)|(t&1);t=((t>>1)|c)&0xFF;R.w8(' + e + ',t);const s=R.A+t+(R.P&1);const r=s&0xFF;R.P=(R.P&~0xC1)|(s>255?1:0)|(((R.A^r)&(t^r)&0x80)!==0?0x40:0);R.A=r;R.setZN(r)'); break;
    case 'ANC': L.push('R.A&=' + V + ';R.setZN(R.A);R.P=(R.P&0xFE)|((R.A>>7)&1)'); break;
    case 'ALR': L.push('R.A&=' + V + ';R.P=(R.P&0xFE)|(R.A&1);R.A=R.A>>1;R.setZN(R.A)'); break;
    case 'ARR': L.push('t=' + V + ';R.A&=t;const aa=R.A;R.A=(aa>>1)|((R.P&1)<<7);R.setZN(R.A)'); break;
    case 'AXS': L.push('t=(R.A&R.X)-(' + V + ');R.X=t&0xFF;R.P=(R.P&0xFE)|(t>=0?1:0);R.setZN(R.X)'); break;
    case 'LAS': L.push('t=R.SP&(' + V + ');R.A=t;R.X=t;R.SP=t;R.setZN(t)'); break;

    case 'NOP':
    default:
      L.push('/* nop */');
      break;
  }

  if (!PC_SETS[mnem]) {
    L.push('R.PC=' + hex4((pc0 + (mode === 'imp' || mode === 'acc' ? 1 : MODE_SIZE[mode])) & 0xFFFF));
  }
  const tail = 'R.tick(' + cyc + ');if(R.fb)return;if(R.nmi||R.irq)R.doInt();';
  L.push(tail);
  return L;
}

// ---------------------------------------------------------------- build
function generate(prg, order) {
  /* emit เป็น function ต่อ page (256 address/page, switch บน PC & 0xFF)
     — switch 16K entries เดียว V8 ไม่สร้าง jump table และ deoptimize เป็นการไล่เทียบ
     ทำให้เกมช้ามาก; switch 256 entries ต่อ function optimize เป็น jump table ได้
     และ dispatch หลักเป็น F0[pc>>8] ซึ่งเร็วคงที่ */
  const byPage = new Map();
  for (const pc of order) {
    const op = readU8(prg, pc);
    const info = INFO[op];
    const mode = info.mode;
    const size = MODE_SIZE[mode];
    const b1 = size >= 2 ? readU8(prg, pc + 1) : 0;
    const w = size >= 3 ? (b1 | (readU8(prg, pc + 2) << 8)) : 0;
    const operandTxt = (mode === 'imp' || mode === 'acc') ? '' : ' ' + opName(mode, b1, w);
    const body = emitInstruction(info.mnem, mode, info.cyc, pc, b1, w).join(';');
    const page = pc >> 8;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push('          case ' + hex2(pc & 0xFF) + ': { /* ' + pc.toString(16).toUpperCase() + ': ' + info.mnem + operandTxt + ' */' + body + '; } break;');
  }
  const fns = [];
  for (const [page, lines] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    fns.push('    ' + hex2(page) + ': function () {\n      var t;\n      switch (R.PC & 0xFF) {\n' + lines.join('\n') + '\n      }\n    }');
  }
  return fns.join(',\n');
}

function disasm(prg) {
  const lines = [];
  let pc = 0x8000;
  const codeEnd = 0x8000 + prg.length;
  while (pc < codeEnd) {
    const op = readU8(prg, pc);
    const info = INFO[op];
    const mode = info.mode;
    const size = MODE_SIZE[mode];
    if (pc + size > codeEnd) break;
    const b1 = size >= 2 ? readU8(prg, pc + 1) : 0;
    const w = size >= 3 ? (b1 | (readU8(prg, pc + 2) << 8)) : 0;
    const bytes = [];
    for (let i = 0; i < size; i++) bytes.push(readU8(prg, pc + i).toString(16).padStart(2, '0').toUpperCase());
    lines.push(pc.toString(16).toUpperCase().padStart(4, '0') + ': ' + bytes.join(' ').padEnd(11) + '  ' + info.mnem.padEnd(3) + ' ' + opName(mode, b1, w));
    pc += size;
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- main
function main() {
  const romPath = process.argv[3];
  if (!romPath) { console.error('usage: node tools/nes2js.cjs [outDir] [rom.nes]'); process.exit(1); }
  const buf = fs.readFileSync(romPath);
  const rom = parseINes(buf);
  if (rom.mapper !== 0) {
    console.warn('WARNING: mapper ' + rom.mapper + ' detected; runtime currently supports mapper 0 fully.');
  }
  if (rom.prgBanks !== 1) {
    console.warn('WARNING: ' + rom.prgBanks + ' PRG banks (NROM expected 1); runtime assumes 16KB PRG.');
  }

  /* ทุก address เป็นจุดเริ่ม instruction ที่ decode ได้ (ตาราง 256 opcodes ครบ)
     — ตามฮาร์ดแวร์ 6502: CPU ที่กระโดดไป address ใดก็ decode จากจุดนั้นเสมอ
     การมี case ครบทุก address จึงไม่มี unreachable state อีกต่อไป
     NROM-128: generate เฉพาะ $8000-$BFFF แล้ว normalize PC ด้วย mirror ตอน execute */
  const NROM128 = rom.prg.length <= 0x4000;
  const allAddrs = [];
  const aEnd = NROM128 ? 0xBFFF : 0xFFFF;
  for (let a = 0x8000; a <= aEnd; a++) allAddrs.push(a);
  const scan = scanROM(rom.prg);
  const code = generate(rom.prg, allAddrs);

  const name = path.basename(romPath, '.nes').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const GAME_OUT = path.join(OUT_DIR, name);   /* แต่ละเกมแยกโฟลเดอร์ของตัวเอง (public/game/{id}/) */
  fs.mkdirSync(GAME_OUT, { recursive: true });

  /* global key derive จากชื่อไฟล์ (เช่น 'nuts-&-milk-japan' -> NUTS_MILK_JAPAN)
     เกมละ key ของตัวเอง จึงโหลดหลาย .rom.js ในหน้าเดียวกันได้ */
  const GKEY = name.toUpperCase().replace(/-/g, '_');

  const romJs = `/* Generated by nes2js.cjs from ${path.basename(romPath)} — do not edit */
/* ${allAddrs.length} instructions transpiled from 6502 machine code (ทุก address ใน ${NROM128 ? '$8000-$BFFF (NROM-128, PC mirrored)' : '$8000-$FFFF'} ) */
(function (g) {
  var ROM = g['${GKEY}'] || (g['${GKEY}'] = {});
  ROM.name = '${name}';
  ROM.mapper = ${rom.mapper};
  ROM.mirror = ${rom.mirrorVertical ? 'true' : 'false'};      // mirrorVertical
  ROM.nrom128 = ${NROM128 ? 'true' : 'false'};
  ROM.vectors = { reset: 0x${scan.reset.toString(16).padStart(4, '0')}, nmi: 0x${scan.nmi.toString(16).padStart(4, '0')}, irq: 0x${scan.irq.toString(16).padStart(4, '0')} };
  ROM.prg = new Uint8Array([${Array.from(rom.prg).join(',')}]);
  ROM.chr = new Uint8Array([${Array.from(rom.chr).join(',')}]);
  /* dispatch เป็นตาราง function ต่อ page (F0[pc>>8]) — switch เดี่ยว 16K entries
     ทำให้ V8 deoptimize (ไล่เทียบเชิงเส้นทุก instruction) เกมจึงช้ามาก
     switch 256 entries ต่อ page function optimize เป็น jump table ได้ */
  ROM.buildExec = function (R) {
    var F0 = {
${code}
    };
    return function exec() {
      for (;;) {
        var fn = F0[${NROM128 ? '(R.PC >> 8) & 0x3F | 0x80' : 'R.PC >> 8'}];
        if (!fn) { R.halt(R.PC); return; }
        fn();
        if (R.fb) return; /* frame boundary — จบเฟรมที่นี่ (return ใน page fn ออกแค่จาก page) */
      }
    };
  };
  if (typeof module !== 'undefined') module.exports = g['${GKEY}'];
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  fs.writeFileSync(path.join(GAME_OUT, name + '.rom.js'), romJs);

  const resJs = `/* Graphics + metadata resources extracted from ${path.basename(romPath)} */
(function (g) {
  var ROM = g['${GKEY}'] || (g['${GKEY}'] = {});
  ROM.resources = {
    chr: ROM.chr,                          // 8192 bytes CHR ROM = graphics data
    palettes: 'embedded in runtime',       // PPU palette RAM is runtime state
    sprites: 'OAM runtime state',
    tiles: { w: ROM.chr.length / 8 / 2, spriteTiles: ROM.chr.length / 8 },
    note: 'CHR pattern tables loaded into PPU VRAM $0000-$1FFF'
  };
  if (typeof module !== 'undefined') module.exports = g['${GKEY}'];
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  fs.writeFileSync(path.join(GAME_OUT, name + '.resources.js'), resJs);
  fs.writeFileSync(path.join(GAME_OUT, name + '.disasm.txt'), disasm(rom.prg));

  const manifest = {
    game: name,
    source: path.basename(romPath),
    mapper: rom.mapper,
    prgBanks: rom.prgBanks,
    chrBanks: rom.chrBanks,
    mirrorVertical: rom.mirrorVertical,
    vectors: scan,
    instructionsTranspiled: allAddrs.length,
    generated: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(GAME_OUT, name + '.manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('OK: ' + name + ' -> ' + allAddrs.length + ' instructions, ' + rom.prg.length + 'B PRG, ' + rom.chr.length + 'B CHR');
}

if (require.main === module) main();

module.exports = { parseINes, scanROM, generate, disasm, buildAddressExpr, emitInstruction };