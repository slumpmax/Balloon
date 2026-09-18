'use strict';
/* nes-runtime.js
 * NES hardware runtime: CPU memory map, PPU (graphics), APU (audio), mapper(NROM),
 * video output, input. Paired with a generated *rom.js file (6502 -> JS transpilation).
 * Headless-friendly (works in Node too).
 */
(function (g) {
  'use strict';

  const CPU_CLOCK = 1789772.727;
  const SAMPLE_RATE = 44100;
  const CYCLES_PER_FRAME = 29780;

/* Firebrandx 2C02 palette (r,g,b) — มาตรฐานที่ใช้ใน Mesen/FCEUX/Nestopia */
  const PALETTE_SRC = [
    [124,124,124],[0,0,252],[0,0,188],[68,40,188],[148,0,132],[168,0,32],[168,16,0],[136,20,0],
    [80,48,0],[0,120,0],[0,104,0],[0,88,0],[0,64,88],[0,0,0],[0,0,0],[0,0,0],
    [188,188,188],[0,120,248],[0,88,248],[104,68,252],[216,0,204],[228,0,88],[248,56,0],[228,92,16],
    [172,124,0],[0,184,0],[0,168,0],[0,168,68],[0,136,136],[0,0,0],[0,0,0],[0,0,0],
    [248,248,248],[60,188,252],[104,136,252],[152,120,248],[248,120,248],[248,88,152],[248,120,88],[252,160,68],
    [248,184,0],[184,248,24],[88,216,84],[88,248,152],[0,232,216],[120,120,120],[0,0,0],[0,0,0],
    [252,252,252],[164,228,252],[184,184,248],[216,184,248],[248,184,248],[248,164,192],[240,208,176],[252,224,168],
    [248,216,120],[216,248,120],[184,248,184],[184,248,216],[0,252,252],[248,216,248],[0,0,0],[0,0,0]
  ];
  const PALETTE = new Uint8Array(64 * 3);
  for (let i = 0; i < 64; i++) { PALETTE[i * 3] = PALETTE_SRC[i][0]; PALETTE[i * 3 + 1] = PALETTE_SRC[i][1]; PALETTE[i * 3 + 2] = PALETTE_SRC[i][2]; }

  const LENGTH = [0x0A,0xFE,0x14,0x02,0x28,0x04,0x50,0x06,0xA0,0x08,0x3C,0x0A,0x0E,0x0C,0x1A,0x0E,0x0C,0x10,0x18,0x12,0x30,0x14,0x60,0x16,0xC0,0x18,0x48,0x1A,0x10,0x1C,0x20,0x1E];
  const NOISE_PERIOD = [4,8,16,32,64,96,128,160,202,254,380,508,762,1016,2034,4068];
  const DMC_FREQ = [428,380,340,320,286,254,226,214,190,160,142,128,106,84,72,54];
  const DUTY = [
    [0,0,0,0,0,0,0,1],
    [0,0,0,0,0,0,1,1],
    [0,0,0,0,1,1,1,1],
    [1,1,1,1,1,1,0,0]
  ];
  /* triangle DAC wave: 32 steps, 4-bit output (0..15) */
  const TRI_WAVE = [15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  /* NES non-linear mixer (blargg / nesdev APU Mixer): two pulse channels share one pin */
  const PULSE_TABLE = new Float64Array(31);
  for (let n = 0; n < 31; n++) PULSE_TABLE[n] = 95.52 / (8128 / n + 100);
  /* APU frame counter step lengths in CPU cycles (VibeNES-verified) */
  const FC_STEP_4 = [7457, 7456, 7458, 7457];
  const FC_STEP_5 = [7457, 7456, 7458, 7457, 7452];

  /* Scale2x (AdvanceMAME) บน palette-index pixels — ใช้ทั้งหน้าเว็บ (real-time)
   * และ tools/export-hd.cjs (offline) เพื่อให้ผลลัพธ์เหมือนกันเป๊ะ
   * out: Uint8Array ขนาด (w*2)*(h*2) ที่ผู้เรียกเตรียมไว้ (zero-alloc ต่อเฟรม) */
  function scale2xIndexInto(px, w, h, out) {
    const W = w * 2;
    for (let y = 0; y < h; y++) {
      const yUp = y > 0 ? y - 1 : 0, yDn = y < h - 1 ? y + 1 : h - 1;
      const r0 = (y * 2) * W, r1 = r0 + W;
      const rowU = yUp * w, rowM = y * w, rowD = yDn * w;
      for (let x = 0; x < w; x++) {
        const xL = x > 0 ? x - 1 : 0, xR = x < w - 1 ? x + 1 : w - 1;
        const B = px[rowU + x], D = px[rowM + xL], E = px[rowM + x], F = px[rowM + xR], H = px[rowD + x];
        const c = x * 2;
        out[r0 + c]     = (D === B && B !== F && D !== H) ? D : E;
        out[r0 + c + 1] = (B === F && B !== D && F !== H) ? F : E;
        out[r1 + c]     = (D === H && D !== B && H !== F) ? D : E;
        out[r1 + c + 1] = (F === H && F !== B && H !== D) ? F : E;
      }
    }
  }

  function createSystem(opts) {
    opts = opts || {};
    const rom = opts.rom;

    // ------------------------------------------------------------ CPU / PPU / APU
    const ram = new Uint8Array(0x800);
    const ppu = {
      ctrl: 0, mask: 0, status: 0,
      oamAddr: 0, oam: new Uint8Array(256),
      v: 0, t: 0, w: 0,
      fineX: 0, scrollX: 0, scrollY: 0,
      vram: new Uint8Array(0x4000),
      dataBuf: 0,
      sp0HitFrame: false,
      /* sprite-0 hit (bit6 ของ $2002): จำลองเป็น event ที่ scanline ของ sprite #0
         เพราะโมเดล whole-frame ไม่มี raster ตลอด exec — เกมอย่าง soccer-world
         รอ flag นี้กลาง NMI เพื่อ split scroll (รอ value 0→1) */
      sp0HitY: -1,
      sp0HitDone: false,
      frameBuffered: false,
      /* split-scroll log: บันทึกทุก $2005 write คู่ พร้อม CPU cycle ที่เกิดขึ้น
         เพื่อให้ renderFrame() รู้ scroll ที่ถูกต้องในแต่ละ scanline */
      scrollLog: [], /* [{ cycles, sx, sy, ctrl }] เรียงตาม cycles */
      scrollPendingX: -1, /* รอ Y pair */
    };
    if (rom) ppu.vram.set(rom.chr.subarray(0, 0x2000), 0);
    if (ppu.vram[0x3F00] === undefined || ppu.vram[0x3F00] === 0) ppu.vram[0x3F00] = 0x0F;

    function ppuPalAddr(a) {
      a = (a - 0x3F00) & 0x1F;
      if (a >= 0x10 && (a & 3) === 0) a -= 0x10;
      return 0x3F00 + a;
    }
    function ppuMap(a) {
      a &= 0x3FFF;
      if (a >= 0x3F00) return ppuPalAddr(a);
      if (a >= 0x3000) return a - 0x1000;
      if (a >= 0x2000) {
        /* Nametable mirroring
           rom.mirror: false = horizontal mirror ($2000=$2400=pageA, $2800=$2C00=pageB)
                       true  = vertical mirror   ($2000=$2800=pageA, $2400=$2C00=pageB) */
        const off = a - 0x2000; /* 0x000–0xFFF (quadrant 0–3, 0x400 each) */
        let page;
        if (!rom || !rom.mirror) {
          /* horizontal: nt0=$2000 nt1=$2400 both → pageA; nt2=$2800 nt3=$2C00 both → pageB */
          page = (off >= 0x800) ? 1 : 0;
        } else {
          /* vertical: nt0=$2000 nt2=$2800 both → pageA; nt1=$2400 nt3=$2C00 both → pageB */
          page = (off & 0x400) ? 1 : 0;
        }
        return 0x2000 + page * 0x400 + (off & 0x3FF);
      }
      return a;
    }

    // ---- APU state
    function mkPulse() {
      return {
        reg: [0,0,0,0], len: 0, freq: 0, phase: 0, freqCtr: 0,
        envDiv: 0, envVol: 15, envStart: false,
        sweepDiv: 0, sweepReload: false, muted: false,
      };
    }
    const p1 = mkPulse();
    const p2 = mkPulse();

    const tri = { reg: [0,0,0], len: 0, freq: 0, phase: 0, freqCtr: 0, linear: 0, linearReload: false };
    const noise = { reg: [0,0,0], len: 0, freq: 0, freqCtr: 0, lfsr: 1, envDiv: 0, envVol: 15, envStart: false };
    const dmc = {
      freq: 0, irqFlag: false, loop: false, delta: 0,
      startAddr: 0, startLen: 0, curAddr: 0, bytesLeft: 0,
      buf: 0, bitsLeft: 0, bufFull: false, active: false, freqCtr: 0,
      irqLatched: false,
    };
    const fc = { count: 0, step: 0, mode5: false, irqInhibit: false, irqFlag: false };

    const readPrg = function (a) {
      a &= 0xFFFF;
      const half = (a >= 0xC000) ? (rom.prg.length > 0x4000 ? 1 : 0) : 0;
      const v = rom.prg[(a & 0x3FFF) + half * 0x4000];
      return v === undefined ? 0 : v;
    };

    const cpu = {
      A: 0, X: 0, Y: 0, P: 0x24, SP: 0xFD, PC: 0x8000,
      cycles: 0, budget: CYCLES_PER_FRAME, fb: false,
      vblCleared: false, vblClearCycles: 2273,
      nmi: false, irq: false, halted: false, haltPC: 0,
      exec: null, ram,
      r8: function (a) {
        a &= 0xFFFF;
        if (a < 0x2000) return ram[a & 0x7FF];
        if (a < 0x4000) {
          switch (a & 7) {
            case 2: return ppu.readStatus();
            case 4: return ppu.readOAM();
            case 7: return ppu.readData();
            default: return 0;
          }
        }
        if (a === 0x4015) return apu.readStatus();
        if (a >= 0x4016 && a <= 0x4017) return controllerRead(a === 0x4016 ? 0 : 1);
        if (a >= 0x8000) return readPrg(a);
        return 0;
      },
      w8: function (a, v) {
        a &= 0xFFFF; v &= 0xFF;
        if (a < 0x2000) { ram[a & 0x7FF] = v; return; }
        if (a < 0x4000) {
          switch (a & 7) {
            case 0: ppu.writeCtrl(v); return;
            case 1: ppu.writeMask(v); return;
            case 3: ppu.oamAddr = v; return;
            case 4: ppu.writeOAM(v); return;
            case 5: ppu.writeScroll(v); return;
            case 6: ppu.writeAddr(v); return;
            case 7: ppu.writeData(v); return;
          }
          return;
        }
        if (a === 0x4014) { ppu.oam.set(ram.subarray(v << 8, (v << 8) + 256)); cpu.cycles += 513; ppu.sp0HitY = ppu.oam[0]; return; }
        if (a === 0x4015) { apu.writeEnable(v); return; }
        if (a === 0x4016) { controllerWrite(v); return; }
        if (a === 0x4017) { apu.writeFrameCounter(v); return; }
        if (a >= 0x4000 && a <= 0x4013) { apu.writeReg(a - 0x4000, v); return; }
      },
      r16: function (a) { return (this.r8(a)) | (this.r8(a + 1) << 8); },
      push8: function (v) { ram[0x100 | this.SP] = v & 0xFF; this.SP = (this.SP - 1) & 0xFF; },
      push16: function (v) { this.push8((v >> 8) & 0xFF); this.push8(v & 0xFF); },
      pop8: function () { this.SP = (this.SP + 1) & 0xFF; return ram[0x100 | this.SP]; },
      pop16: function () { const lo = this.pop8(); const hi = this.pop8(); return (hi << 8) | lo; },
      setZN: function (v) { v &= 0xFF; this.P = (this.P & ~0x82) | (v === 0 ? 0x02 : 0) | (v & 0x80); },
      tick: function (n) {
        this.cycles += n;
        if (this.cycles >= this.vblClearCycles && !this.vblCleared && (ppu.status & 0x80)) {
          this.vblCleared = true;
          ppu.status &= 0x7F; /* vblank ends when rendering starts */
        }
        /* sprite-0 hit: raster ถึงแถว Y ของ sprite #0 → bit6 ขึ้น (คงค้างทั้งเฟรม
           จนกว่า vblank ถัดไป; ต้องมี BG+sprite rendering เปิด และ sprite #0 อยู่บนจอ) */
        if (!ppu.sp0HitDone && (ppu.mask & 0x18) && ppu.sp0HitY >= 0 && ppu.sp0HitY < 0xEF &&
            this.cycles >= ppu.sp0HitY * (CYCLES_PER_FRAME / 262)) {
          ppu.sp0HitDone = true;
          ppu.status |= 0x40;
        }
        if (this.cycles >= this.budget) this.fb = true;
      },
      doInt: function () {
        if (this.irq && !this.nmi && (this.P & 0x04)) return; /* 6502: IRQ masked while I=1 (NMI ignores I) */
        const vec = this.nmi ? rom.vectors.nmi : rom.vectors.irq;
        this.push16(this.PC & 0xFFFF);
        this.push8((this.P & 0xEF) | 0x20);
        this.P |= 0x04;
        this.PC = vec;
        if (rom.nrom128) this.PC = ((this.PC & 0x3FFF) | 0x8000); /* NROM-128: normalize เข้าช่วงที่มี case */
        this.nmi = false; this.irq = false;
      },
      halt: function (pc) { this.halted = true; this.haltPC = pc; msg('CPU halted at $' + pc.toString(16).toUpperCase() + ' (unreachable state)'); },
    };

    // ---- PPU register handlers
    ppu.readStatus = function () {
      const s = this.status;
      this.status &= 0x7F;
      this.w = 0;
      return s;
    };
    ppu.readOAM = function () { return this.oam[this.oamAddr]; };
    ppu.writeOAM = function (v) { this.oam[this.oamAddr] = v & 0xFF; this.oamAddr = (this.oamAddr + 1) & 0xFF; };
    ppu.advanceV = function () { this.v = (this.v + (this.ctrl & 0x04 ? 32 : 1)) & 0x3FFF; };
    ppu.writeCtrl = function (v) {
      this.ctrl = v;
      if (this.w === 0) this.t = (this.t & ~0x0C00) | ((v & 3) << 10);
      /* NMI is asserted only at vblank origin (enterVBlank). Do not latch an
         immediate NMI here: in the whole-frame model the vblank window covers
         the first CYCLES_PER_FRAME-derived cycles, so mid-frame $2000 writes
         would spuriously trigger an NMI inside the game's main loop. */
    };
    ppu.writeMask = function (v) { this.mask = v; };
    ppu.writeScroll = function (v) {
      if (this.w === 0) {
        this.fineX = v & 7;
        this.scrollX = v & 0xFF;
        this.t = (this.t & 0xFFE0) | ((v >> 3) & 0x1F) | ((v & 7) << 12);
        this.w = 1;
        /* บันทึก X ไว้รอ Y pair */
        this.scrollPendingX = v & 0xFF;
      } else {
        this.scrollY = ((v >> 3) & 0x1F) * 8 + (v & 7);
        this.t = (this.t & 0x8C1F) | (((v >> 3) & 0x1F) << 5) | ((v & 7) << 12);
        this.w = 0;
        /* บันทึก scroll คู่นี้พร้อม CPU cycle และ ctrl ปัจจุบัน */
        if (this.scrollPendingX >= 0) {
          this.scrollLog.push({
            cycles: cpu.cycles,
            sx: this.scrollPendingX,
            sy: this.scrollY,
            ctrl: this.ctrl,
          });
          this.scrollPendingX = -1;
        }
      }
    };
    ppu.writeAddr = function (v) {
      if (this.w === 0) {
        this.t = (this.t & 0x80FF) | ((v & 0x3F) << 8);
        this.w = 1;
      } else {
        this.t = (this.t & 0xFF00) | v;
        this.v = this.t;
        this.w = 0;
      }
    };
    ppu.writeData = function (v) {
      const a = ppuMap(this.v);
      if (a >= 0x3F00) v &= 0x3F;
      this.vram[a] = v & 0xFF;
      this.advanceV();
    };
    ppu.readData = function () {
      const a = ppuMap(this.v);
      const b = this.dataBuf;
      this.dataBuf = (a >= 0x3F00) ? (this.vram[a] & 0x3F) : this.vram[a];
      this.advanceV();
      return b;
    };

    // ---- APU register handlers
    const apu = {
      p1, p2, tri, noise, dmc, fc, dcX: 0, dcY: 0,
      readStatus: function () {
        let s = 0;
        if (this.p1.len > 0) s |= 1;
        if (this.p2.len > 0) s |= 2;
        if (this.tri.len > 0) s |= 4;
        if (this.noise.len > 0) s |= 8;
        if (this.dmc.active || this.dmc.bytesLeft > 0) s |= 16;
        if (this.dmc.irqLatched) s |= 0x40;
        this.dmc.irqLatched = false;
        if (this.fc.irqFlag) s |= 0x80;
        this.fc.irqFlag = false;
        return s;
      },
      writeEnable: function (v) {
        if (!(v & 1)) this.p1.len = 0;
        if (!(v & 2)) this.p2.len = 0;
        if (!(v & 4)) this.tri.len = 0;
        if (!(v & 8)) this.noise.len = 0;
        const was = this.dmc.active || this.dmc.bitsLeft > 0;
        if (!(v & 0x10)) {
          this.dmc.active = false; this.dmc.bitsLeft = 0; this.dmc.bufFull = false;
        } else if (!was && !this.dmc.bufFull && this.dmc.startLen > 0) {
          this.dmc.active = true;
          this.dmc.curAddr = this.dmc.startAddr;
          this.dmc.bytesLeft = this.dmc.startLen;
          dmcLoad(this);
        }
      },
      writeFrameCounter: function (v) {
        this.fc.mode5 = (v & 0x80) !== 0;
        this.fc.irqInhibit = (v & 0x40) !== 0;
        this.fc.count = 0;
        this.fc.step = 0;
        this.fc.irqFlag = false;
        if (this.fc.mode5) {
          quarterEvents(this);
          halfEvents(this);
        }
      },
      writeReg: function (i, v) {
        v &= 0xFF;
        if (i <= 3) applyPulse(this.p1, i, v);
        else if (i <= 7) applyPulse(this.p2, i - 4, v);
        else if (i === 8) { this.tri.reg[0] = v; this.tri.linearReload = true; }
        else if (i === 10) { this.tri.reg[1] = v; this.tri.freq = (this.tri.freq & 0xFF00) | v; }
        else if (i === 11) { this.tri.reg[2] = v; this.tri.phase = 0; this.tri.freqCtr = 0; this.tri.freq = (this.tri.freq & 0x00FF) | ((v & 7) << 8); this.tri.len = LENGTH[(v >> 3) & 0x1F]; }
        else if (i === 12) { this.noise.reg[0] = v; this.noise.envStart = true; }
        else if (i === 14) { this.noise.reg[1] = v; this.noise.freq = NOISE_PERIOD[v & 0x0F]; }
        else if (i === 15) { this.noise.reg[2] = v; this.noise.len = LENGTH[(v >> 3) & 0x1F]; this.noise.envStart = true; }
        else if (i === 16) { this.dmc.freq = DMC_FREQ[v & 0x0F]; this.dmc.irqFlag = (v & 0x80) !== 0; this.dmc.loop = (v & 0x40) !== 0; }
        else if (i === 17) { this.dmc.delta = v & 0x7F; }
        else if (i === 18) { this.dmc.startAddr = 0xC000 + (v << 6); }
        else if (i === 19) { this.dmc.startLen = (v << 4) | 1; }
      },
      stepCycles: function (n) {
        while (n-- > 0) step1cycle(this);
      },
      generate: function (out, frames) {
        const cps = CPU_CLOCK / SAMPLE_RATE;
        let acc = 0, xLast = this.dcX, yLast = this.dcY;
        for (let i = 0; i < frames; i++) {
          acc += cps;
          while (acc >= 1) { step1cycle(this); acc -= 1; }
          const x = mix() * 0.9;
          const y = x - xLast + 0.998 * yLast; /* DC blocker */
          xLast = x; yLast = y;
          out[i] = y > 1 ? 1 : (y < -1 ? -1 : y);
        }
        this.dcX = xLast; this.dcY = yLast;
      },
    };

    /* quarter frame: envelopes + triangle linear counter */
    function quarterEvents(a) {
      clockEnvelope(a.p1);
      clockEnvelope(a.p2);
      clockLinear(a.tri);
      clockEnvelope(a.noise);
    }
    /* half frame: length counters + sweep units */
    function halfEvents(a) {
      clockLength(a.p1);
      clockLength(a.p2);
      clockTriLength(a.tri);
      clockLength(a.noise);
      clockSweep(a.p1);
      clockSweep(a.p2);
    }
    /* frame counter ($4017): fires quarter/half frame clocks from the real step table */
    function fcClock(a) {
      const f = a.fc;
      f.count++;
      const target = f.mode5 ? FC_STEP_5[f.step] : FC_STEP_4[f.step];
      if (f.count < target) return;
      f.count = 0;
      if (f.mode5) {
        if (f.step !== 3) quarterEvents(a);
        if (f.step === 1 || f.step === 4) halfEvents(a);
      } else {
        quarterEvents(a);
        if (f.step === 1 || f.step === 3) {
          halfEvents(a);
          if (f.step === 3 && !f.irqInhibit) { f.irqFlag = true; cpu.irq = true; }
        }
      }
      f.step = (f.step + 1) % (f.mode5 ? 5 : 4);
    }
    /* envelope: clocked on quarter frame */
    function clockEnvelope(p) {
      if (p.envStart) {
        p.envStart = false;
        p.envVol = 15;
        p.envDiv = p.reg[0] & 0x0F;
      } else if (p.envDiv === 0) {
        p.envDiv = p.reg[0] & 0x0F;
        if (p.envVol === 0) { if (p.reg[0] & 0x20) p.envVol = 15; }
        else p.envVol--;
      } else p.envDiv--;
    }
    /* length counter: clocked on half frame; frozen while loop/hold flag is set */
    function clockLength(p) {
      if (!(p.reg[0] & 0x20) && p.len > 0) p.len--;
    }
    function clockTriLength(t) {
      if (!(t.reg[0] & 0x80) && t.len > 0) t.len--;
    }
    /* triangle linear counter: clocked on quarter frame */
    function clockLinear(t) {
      if (t.linearReload) {
        t.linear = t.reg[0] & 0x7F;
        t.linearReload = false;
      } else if (t.linear > 0) t.linear--;
    }
    /* pulse sweep unit: clocked on half frame */
    function clockSweep(p) {
      const reg = p.reg[1];
      if (reg & 0x80) {
        if (p.sweepDiv === 0 && !p.sweepReload) {
          const amt = p.freq >> (reg & 7);
          const target = (reg & 0x08) ? (p.freq - amt - 1) : (p.freq + amt);
          if (target < 8 || target > 0x7FF) p.muted = true;
          else p.freq = target;
        }
        if (p.sweepDiv === 0 || p.sweepReload) {
          p.sweepDiv = ((reg >> 4) & 7) + 1;
          p.sweepReload = false;
        } else p.sweepDiv--;
      } else {
        p.sweepReload = false;
      }
    }
    function applyPulse(p, i, v) {
      p.reg[i] = v;
      if (i === 0) p.envStart = true;
      if (i === 1) p.sweepReload = true;
      if (i === 2) { p.freq = (p.freq & 0xFF00) | v; p.muted = false; }
      if (i === 3) {
        p.freq = (p.freq & 0x00FF) | ((v & 7) << 8);
        p.len = LENGTH[(v >> 3) & 0x1F];
        p.phase = 0; p.freqCtr = 0;
        p.envStart = true; p.muted = false;
      }
    }
    function dmcLoad(d) {
      if (d.curAddr >= 0x8000) d.buf = readPrg(d.curAddr);
      d.bitsLeft = 8; d.bufFull = true;
      d.curAddr = ((d.curAddr + 1) & 0x3FFF) | 0xC000;
      d.bytesLeft--;
    }
    function step1cycle(a) {
      fcClock(a);
      const p = a.p1;
      if (p.len > 0) { p.freqCtr--; if (p.freqCtr <= 0) { p.freqCtr = p.freq; p.phase = (p.phase + 1) & 7; } }
      const p2 = a.p2;
      if (p2.len > 0) { p2.freqCtr--; if (p2.freqCtr <= 0) { p2.freqCtr = p2.freq; p2.phase = (p2.phase + 1) & 7; } }
      const t = a.tri;
      if (t.len > 0 && t.linear > 0) { t.freqCtr--; if (t.freqCtr <= 0) { t.freqCtr = t.freq; t.phase = (t.phase + 1) & 31; } }
      const n = a.noise;
      if (n.len > 0) {
        n.freqCtr--;
        if (n.freqCtr <= 0) {
          n.freqCtr = n.freq;
          const fb = (n.lfsr & 1) ^ ((n.lfsr >> 1) & 1);
          n.lfsr = (n.lfsr >> 1) | (fb << ((n.reg[0] & 0x80) ? 6 : 14));
        }
      }
      const d = a.dmc;
      if (d.active && d.bitsLeft > 0) {
        d.freqCtr--;
        if (d.freqCtr <= 0) {
          d.freqCtr = d.freq;
          const bit = d.buf & 1;
          d.buf >>= 1; d.bitsLeft--;
          if (bit) { d.delta = Math.min(127, d.delta + 2); } else { d.delta = Math.max(0, d.delta - 2); }
          if (d.bitsLeft === 0) {
            if (d.bytesLeft > 0) dmcLoad(d);
            else {
              if (d.loop) { d.curAddr = d.startAddr; d.bytesLeft = d.startLen; dmcLoad(d); }
              else {
                d.active = false;
                if (d.irqFlag) { d.irqLatched = true; cpu.irq = true; }
              }
            }
          }
        }
      }
    }
    function apuReset() {
      [p1, p2, tri, noise, dmc].forEach(o => { for (const k in o) if (typeof o[k] === 'number') o[k] = 0; });
      p1.envStart = p2.envStart = noise.envStart = false;
      p1.sweepReload = p2.sweepReload = false;
      p1.muted = p2.muted = false;
      tri.linearReload = false;
      dmc.bufFull = false;
      p1.envVol = p2.envVol = noise.envVol = 15;
      /* หยุดทุก channel ชัดเจน — ป้องกันโน้ตค้างถ้า generate() ถูกเรียกหลัง reset */
      p1.len = p2.len = tri.len = noise.len = 0;
      dmc.active = false; dmc.bytesLeft = 0;
      noise.lfsr = 1;
      fc.count = 0; fc.step = 0; fc.mode5 = false; fc.irqInhibit = false; fc.irqFlag = false;
      const a = apu; a.dcX = 0; a.dcY = 0;
    }
    /* pulse output level (0..15); silenced by length counter, sweep overflow, low timer or duty off */
    function pulseVol(p) {
      if (p.len === 0 || p.muted || p.freq < 8) return 0;
      const duty = (p.reg[0] >> 6) & 3;
      if (!DUTY[duty][p.phase]) return 0;
      return (p.reg[0] & 0x10) ? (p.reg[0] & 0x0F) : p.envVol;
    }
    /* non-linear NES mixer: pulse pin + tnd pin (nesdev APU Mixer) */
    function mix() {
      let s = PULSE_TABLE[pulseVol(apu.p1) + pulseVol(apu.p2)];
      let tnd = 0;
      const t = apu.tri;
      if (t.len > 0 && t.linear > 0) tnd += TRI_WAVE[t.phase] / 8227;
      const n = apu.noise;
      if (n.len > 0) {
        const nv = (n.reg[0] & 0x10) ? (n.reg[0] & 0x0F) : n.envVol;
        tnd += (n.lfsr & 1 ? 0 : nv) / 12241;
      }
      tnd += apu.dmc.delta / 22638;
      s += 159.79 / ((1 / tnd) + 100);
      return s;
    }

    // ---- controllers
    let padStates = [0, 0]; /* packed bits */
    let padShift = [0, 0];
    let strobe = false;
    function packPad(port) {
      let v = 0;
      const q = sysPad[port];
      if (q.A) v |= 1; if (q.B) v |= 2; if (q.sel) v |= 4; if (q.start) v |= 8;
      if (q.up) v |= 16; if (q.down) v |= 32; if (q.left) v |= 64; if (q.right) v |= 128;
      return v;
    }
    const sysPad = [
      { A: 0, B: 0, sel: 0, start: 0, up: 0, down: 0, left: 0, right: 0 },
      { A: 0, B: 0, sel: 0, start: 0, up: 0, down: 0, left: 0, right: 0 },
    ];
    const controllerRead = function (port) {
      const p = port === 0 ? 0 : 1;
      if (strobe) return padStates[p] & 1;
      const v = padShift[p] & 1;
      padShift[p] = (padShift[p] >> 1) | 0x8000;
      return v & 0xFF;
    };
    const controllerWrite = function (v) {
      strobe = (v & 1) === 1;
      if (strobe) { padStates[0] = packPad(0); padStates[1] = packPad(1); padShift[0] = padStates[0]; padShift[1] = padStates[1]; }
    };

    // ------------------------------------------------------------ video
    const video = {
      pixels: new Uint8Array(256 * 240),
    };
    const bgPatOf = () => (ppu.ctrl & 0x10) ? 0x1000 : 0;
    const spPatOf = () => (ppu.ctrl & 0x08) ? 0x1000 : 0;

    function renderFrame() {
      const px = video.pixels;
      px.fill(ppu.vram[0x3F00] & 0x3F);
      if (!rom) return;
      const mask = ppu.mask;
      if (!(mask & 0x18)) return; /* rendering disabled -> black */
      const vram = ppu.vram;
      const fineX0 = ppu.fineX, sx = ppu.scrollX, sy = ppu.scrollY;
      const showBg = (mask & 0x08) !== 0;
      const showSp = (mask & 0x10) !== 0;
      const spPat = spPatOf(); /* sprite pattern table ไม่เปลี่ยนกลางเฟรม */
      ppu.sp0HitFrame = false;

      /* ---- สร้าง per-scanline scroll table จาก scrollLog ----
         แต่ละ entry ใน scrollLog มี { cycles, sx, sy, ctrl }
         แปลง cycles เป็น scanline ที่ scroll นั้น "เริ่มมีผล"
         (1 scanline = CYCLES_PER_FRAME / 262 CPU cycles)
         scanline 0..239 = visible lines, 240..261 = vblank

         กลยุทธ์:
         - entry แรกสุด (เขียนใน NMI ก่อน rendering) ใช้กับทุก scanline เป็น default
         - entry หลังๆ ที่เขียนหลัง sprite-0 hit (mid-frame) จะเริ่มมีผลตั้งแต่
           scanline ที่สอดคล้องกับ cycle นั้น */
      const cyclesPerLine = CYCLES_PER_FRAME / 262;
      const log = ppu.scrollLog;

      /* สร้าง array scroll สำหรับแต่ละ scanline 0-239 */
      let lineSx, lineSy, lineCtrl;
      /* ctrl ณ end-of-frame ใช้ได้สำหรับทุก scanline —
         เกมทั่วไปเขียน $2000 ใน NMI หลัง $2005 เสมอ ดังนั้น ppu.ctrl
         สุดท้ายคือค่าที่ถูกต้องสำหรับ nametable base / bgPat / spPat */
      const frameCtrl = ppu.ctrl;
      if (log.length === 0) {
        /* ไม่มี log เลย — ใช้ค่าปัจจุบัน */
        lineSx = new Uint8Array(240).fill(sx);
        lineSy = new Uint8Array(240).fill(sy & 0xFF);
        lineCtrl = new Uint8Array(240).fill(frameCtrl);
      } else {
        lineSx   = new Uint8Array(240);
        lineSy   = new Uint8Array(240);
        lineCtrl = new Uint8Array(240);
        /* scroll sx/sy อาจเปลี่ยนกลางเฟรม (split-scroll via sprite-0 hit)
           แต่ ctrl ใช้ค่า end-of-frame ตลอด */
        let curSx = log[0].sx, curSy = log[0].sy & 0xFF;
        let logIdx = 1;
        for (let y = 0; y < 240; y++) {
          const lineStart = y * cyclesPerLine;
          while (logIdx < log.length && log[logIdx].cycles <= lineStart) {
            curSx = log[logIdx].sx;
            curSy = log[logIdx].sy & 0xFF;
            logIdx++;
          }
          lineSx[y]   = curSx;
          lineSy[y]   = curSy;
          lineCtrl[y] = frameCtrl;
        }
      }

      if (showBg) {
        for (let y = 0; y < 240; y++) {
          const sx = lineSx[y], sy = lineSy[y];
          const ntSelect = lineCtrl[y] & 3; /* bit1=vnt base, bit0=hnt base */
          const vy = sy + y;
          const ty = vy >> 3;
          const fy = vy & 7;
          const rowOff = ty & 31;
          const rowBase = y * 256;
          const attrRow = (rowOff >> 2) * 8;
          const bgPat = (lineCtrl[y] & 0x10) ? 0x1000 : 0;
          /* แถวเกิน 256px (ty >= 32) ให้ข้ามไปอีก nametable แนวตั้ง (flip bit1 ของ ntSelect) */
          const ntSelectRow = ntSelect ^ ((ty >> 5) ? 2 : 0);
          for (let x = 0; x < 256; x++) {
            const vx = sx + x;
            const tx = vx >> 3;
            const col = tx & 31;
            /* คอลัมน์เกิน 256px (tx >= 32) ให้ข้ามไปอีก nametable แนวนอน (flip bit0) */
            const ntSelectFinal = ntSelectRow ^ ((tx >> 5) ? 1 : 0);
            /* แปลง ntSelect (0-3) เป็น logical nametable address แล้วส่งผ่าน ppuMap
               เพื่อ apply horizontal/vertical mirror ตาม ROM config อย่างถูกต้อง */
            const logicalNt = 0x2000 + ntSelectFinal * 0x400;
            const ntBase = ppuMap(logicalNt);
            const tAddr = ntBase + rowOff * 32 + col;
            const tile = vram[tAddr];
            const attr = vram[ppuMap(logicalNt + 0x3C0) + attrRow + (col >> 2)];
            /* สเปก NES: attribute byte แบ่งเป็น 4 quadrant (2x2 tiles) —
               shift = 0/2 (คอลัมน์คู่/คี่ของ quadrant) + 0/4 (แถวคู่/คี่ของ quadrant) */
            const shift = ((col & 2) ? 2 : 0) | ((rowOff & 2) ? 4 : 0);
            const pal = (attr >> shift) & 3;
            const t0 = vram[bgPat + tile * 16 + fy];
            const t1 = vram[bgPat + tile * 16 + 8 + fy];
            const bit = 7 - (vx & 7);
            const pv = ((t0 >> bit) & 1) | (((t1 >> bit) & 1) << 1);
            let pidx;
            if (pv === 0) pidx = vram[0x3F00] & 0x3F;
            else pidx = vram[0x3F00 + (pal << 2) + pv] & 0x3F;
            px[rowBase + x] = pidx;
          }
        }
      }

      if (showSp) {
        const oam = ppu.oam;
        const list = [];
        for (let i = 0; i < 64; i++) {
          const y = oam[i * 4];
          if (y >= 0xEF) continue;
          list.push({ i, y, x: oam[i * 4 + 3], tile: oam[i * 4 + 1], attr: oam[i * 4 + 2] });
        }
        list.sort((a, b) => (a.x - b.x) || (a.i - b.i));
        for (const s of list) {
          const palBase = (s.attr & 3) << 2;
          const flipH = (s.attr & 0x40) !== 0;
          const flipV = (s.attr & 0x80) !== 0;
          const behind = (s.attr & 0x20) !== 0;
          const backdrop = vram[0x3F00] & 0x3F;
          for (let dy = 0; dy < 8; dy++) {
            const syy = s.y + dy;
            if (syy >= 240) continue;
            const fy = flipV ? (7 - dy) : dy;
            const tile = s.tile;
            const t0 = vram[spPat + tile * 16 + fy];
            const t1 = vram[spPat + tile * 16 + 8 + fy];
            const row = syy * 256;
            for (let dx = 0; dx < 8; dx++) {
              const sxx = s.x + dx;
              if (sxx < 0 || sxx >= 256) continue;
              const bit = flipH ? dx : (7 - dx);
              const pv = ((t0 >> bit) & 1) | (((t1 >> bit) & 1) << 1);
              if (pv === 0) continue;
              const cur = px[row + sxx];
              if (behind && cur !== backdrop) continue;
              /* สไปรต์ใช้ชุดพาเลต $3F10-$3F1F (hardware sprite palettes) ไม่ใช่ชุด BG */
              const pidx = vram[0x3F10 + palBase + pv] & 0x3F;
              px[row + sxx] = pidx;
              if (s.i === 0 && cur !== backdrop) ppu.sp0HitFrame = true;
            }
          }
        }
      }
      ppu.status = (ppu.status & ~0x40) | (ppu.sp0HitFrame ? 0x40 : 0);
    }

    // ------------------------------------------------------------ system
    let audioActive = false;
    let audioCtx = null, audioNode = null;
    let frameCount = 0;
    let blitScratch2 = null, blitScratch4 = null;

    const sys = {
      cpu, ppu, apu, video, rom,
      reset: function () {
        ram.fill(0);
        cpu.A = cpu.X = cpu.Y = 0; cpu.P = 0x24; cpu.SP = 0xFD; cpu.nmi = cpu.irq = false; cpu.halted = false;
        cpu.PC = rom ? rom.vectors.reset : 0x8000;
        if (rom && rom.nrom128) cpu.PC = ((cpu.PC & 0x3FFF) | 0x8000); /* NROM-128: mirror เข้าช่วงที่มี case */
        ppu.ctrl = ppu.mask = ppu.status = 0; ppu.oamAddr = 0; ppu.w = 0; ppu.v = ppu.t = 0; ppu.fineX = 0; ppu.scrollX = ppu.scrollY = 0;
        ppu.scrollLog = []; ppu.scrollPendingX = -1;
        ppu.vram.fill(0);
        if (rom) ppu.vram.set(rom.chr.subarray(0, 0x2000), 0);
        ppu.vram[0x3F00] = 0x0F;
        apuReset();
        frameCount = 0;
        ppu.enterVBlank();
      },
      setButton: function (port, name, down) {
        const map = { A: 'A', B: 'B', sel: 'sel', sel: 'sel', start: 'start', up: 'up', down: 'down', left: 'left', right: 'right' };
        if (map[name]) sysPad[port][map[name]] = down ? 1 : 0;
      },
      frame: function () {
        if (cpu.halted) {
          /* keep rendering the last frame so the page isn't blank */
          if (frameCount++ % 2 === 0) renderFrame();
          return;
        }
        cpu.cycles = 0; cpu.budget = CYCLES_PER_FRAME; cpu.fb = false; cpu.vblCleared = false;
        ppu.enterVBlank();
        cpu.exec();
        renderFrame();
        if (!audioActive || opts.headless) apu.stepCycles(CYCLES_PER_FRAME);
        frameCount++;
      },
      attachCanvas: function (canvas) {
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(256, 240);
        sys.blit = function () {
          sys.blitTo(img);
          ctx.putImageData(img, 0, 0);
        };
        sys.blit();
      },
      blit: function () { /* no-op until attachCanvas */ },
      /* เขียนเฟรม 256x240 เป็น RGBA ลง ImageData ที่ผู้เรียกสร้างไว้ (ไม่ putImageData เอง) */
      blitTo: function (img) {
        const px = video.pixels, d = img.data;
        for (let i = 0; i < 256 * 240; i++) {
          const p = px[i] * 3;
          d[i * 4] = PALETTE[p]; d[i * 4 + 1] = PALETTE[p + 1]; d[i * 4 + 2] = PALETTE[p + 2]; d[i * 4 + 3] = 255;
        }
      },
      /* Scale2x เรียลไทม์: times = 2 หรือ 4 — ขยายในโดเมน index ก่อนแปลงสี
       * img: ImageData ขนาด (256*times)x(240*times), scratch: buffer ภายในใช้ซ้ำ */
      blitScale2x: function (img, times) {
        times = times || 2;
        if (!blitScratch2) blitScratch2 = new Uint8Array(512 * 480);
        scale2xIndexInto(video.pixels, 256, 240, blitScratch2);
        let src = blitScratch2, n = 512 * 480;
        if (times === 4) {
          if (!blitScratch4) blitScratch4 = new Uint8Array(1024 * 960);
          scale2xIndexInto(blitScratch2, 512, 480, blitScratch4);
          src = blitScratch4; n = 1024 * 960;
        }
        const d = img.data;
        for (let i = 0; i < n; i++) {
          const p = src[i] * 3, o = i * 4;
          d[o] = PALETTE[p]; d[o + 1] = PALETTE[p + 1]; d[o + 2] = PALETTE[p + 2]; d[o + 3] = 255;
        }
      },
      startAudio: function () {
        if (typeof window === 'undefined' || !window.AudioContext) return;
        try {
          /* เรียกซ้ำได้ทุกเมื่อ — ถ้ามี context แล้วแค่ resume (unlock หลัง user gesture) */
          if (audioActive) { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); return; }
          const AC = window.AudioContext || window.webkitAudioContext;
          const ctx = new AC();
          audioCtx = ctx;
          const node = ctx.createScriptProcessor(4096, 0, 1);
          const buf = new Float32Array(4096);
          node.onaudioprocess = function (e) {
            const out = e.outputBuffer.getChannelData(0);
            apu.generate(buf, 4096);
            out.set(buf);
          };
          node.connect(ctx.destination);
          audioNode = node;
          audioActive = true;
          if (ctx.state === 'suspended') ctx.resume();
        } catch (err) { msg('audio unavailable: ' + err.message); }
      },
      stopAudio: function () {
        if (audioNode) { try { audioNode.disconnect(); } catch (e) {} audioNode = null; }
        if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
        audioActive = false;
      },
      isHalted: function () { return cpu.halted; },
      getFrameCount: function () { return frameCount; },
    };

    /* vblank + NMI origin */
    ppu.enterVBlank = function () {
      if (ppu.status & 0x80) return; /* already asserted */
      ppu.status |= 0x80;
      ppu.status &= ~0x40; /* เริ่มเฟรมใหม่: sprite-0 hit ถูกรีเซ็ต (ค้างจากเฟรมก่อน) */
      ppu.sp0HitDone = false;
      ppu.scrollLog = [];   /* เริ่มเฟรมใหม่: ล้าง split-scroll log */
      ppu.scrollPendingX = -1;
      if (ppu.ctrl & 0x80) cpu.nmi = true;
    };

    function msg(s) { if (typeof console !== 'undefined' && console.log) console.log('[nes] ' + s); }

    sys.reset();
    cpu.exec = rom ? rom.buildExec(cpu) : null;
    return sys;
  }

  g.NesRuntime = { createSystem, PALETTE, scale2xIndexInto, CYCLES_PER_FRAME, CPU_CLOCK, SAMPLE_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.NesRuntime;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));