# Balloon Fight — NES → Web (6502 → JS, ไม่ใช้ emulator)

แปลง `Balloon Fight (USA).nes` ให้เล่นในเบราว์เซอร์ โดย **แปลงทุกคำสั่ง 6502 ใน ROM เป็นโค้ด JavaScript จริง** แล้วเสริมชั้น runtime
ขั้นต่ำสำหรับ PPU / APU / ระบบหน่วยความจำ (Mapper 0 / NROM) ซึ่งไม่สามารถตัดออกได้

## ใช้งาน

```powershell
npm install          # (ไม่มี dependency — ได้แค่ convenience)
npm run build        # อ่าน ROM -> generate public/game/*.rom.js + resources + disasm + manifest
npm run smoke        # ทดสอบ headless ใน Node รันเกมหลายร้อยเฟรม แล้ว dump เฟรมเป็น ASCII
npm run serve        # รัน web server ที่พอร์ต 8080 แล้วเปิด http://localhost:8080
```

คีย์บอร์ดในหน้าเว็บ: ลูกศร = เลื่อน/ลอย · `Z` = B (เป่าลูกโป่ง) · `X` = A (เตะ) · `Enter` = Start ·
`Shift` = Select · `P` = หยุด · `R` = restart · `M` = เปิด/ปิดเสียง

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `tools/opcodes.cjs` | ตาราง opcode 6502 (ทุกโหมด, cycle) |
| `tools/nes2js.cjs` | parser iNES → scan code (reset/nmi/irq + linear ทั้ง ROM) → emit JS |
| `tools/smoke.cjs` | เทสต์ headless + ASCII frame dump |
| `public/nes-runtime.js` | runtime: CPU core, PPU (BG/sprites/palette/scroll/NMI), APU (pulse/noise/tri/dmc), input, headless |
| `public/index.html` | หน้าเล่นเกม (canvas + keyboard + audio) |
| `public/game/*.rom.js` | เอาต์พุตที่ Generate (16266 cases ของ `switch(R.PC)`) + PRG/CHR/vectors |

## หลักการทำงาน

1. `nes2js.cjs` อ่าน header iNES (Mapper 0, PRG 16KB, CHR 8KB) แยก vectors
   (`reset=$C000, nmi=$C094, irq=$C0F7`)
2. สแกน control flow จาก vectors + เดิน linear ผ่านทั้ง 32KB logical เพื่อครอบคลุมโค้ดที่
   reach ได้ทาง indirect jump / RTS (ปกติ static scan ตกหล่มจุดนี้)
3. ปล่อย `switch(R.PC){ case 0xc000: { ... } }` — หนึ่ง case ต่อหนึ่งคำสั่ง 6502
   ทุก case ลงท้ายด้วย `R.PC=<next>; R.tick(cyc); if(R.fb)return; if(R.nmi||R.irq)R.doInt();`
4. Runtime จำลอง PPU: nametable/tile rendering ตาม `ctrl/mask/scroll`, palette,
   sprite (OAM, priority, flip), vblank flag + NMI ต่อเฟรม; APU แบบใกล้เคียงจริง

## หมายเหตุ / ข้อจำกัด

- ระบบเสียง implement ตาม APU จริง NES (ความถี่/ระยะเวลาตรง VibeNES): pulse 2 ช่องพร้อม **sweep unit +
  envelope + length counter** ตามสเปก, triangle (linear counter + length), noise (LFSR bit-0 โมด),
  DMC พื้นฐาน; **frame counter ($4017)** โหมด 4/5-step จากตารางช่วงจังหวะจริง, **mixer แบบ
  non-linear** (pulse/tnd ของ nesdev APU Mixer) + DC blocker — melody/SFX หลักของเกมเล่นถูกต้อง
  และเกมเขียน `$4017=$C0` (5-step, IRQ inhibit) เป็นโหมดเดียวที่เกมใช้จริง
- ไม่ลอง emulator ใดๆ — CPU ทำงานด้วยโค้ด JS ที่ transpile ตรงจาก bytecode เกม
- ใช้ palette **Firebrandx 2C02** (มาตรฐาน Mesen/FCEUX) และสีพื้นจาก `$3F00` ตอน rendering-off
  เพื่อให้สีตรงต้นฉบับ (สลับได้ถ้าอยากลอง palette แบบอื่นใน `public/nes-runtime.js`)
- NROM 16KB mirroring: `$8000-$BFFF` และ `$C000-$FFFF` ชี้ไป PRG คันเดียว
- เมื่อ generate ใหม่ชื่อไฟล์ ROM อาจเปลี่ยน (`balloon-fight-usa.`*) ให้ตรวจ
  ตรง `<script src>` ใน `public/index.html` ให้ตรงกัน

## สถานะ

- Boot ผ่า vblank triple-wait, เข้า title screen "Balloon Fight" ถูกต้อง
- เกมลูปเสถียร 5000+ เฟรม ไม่ halt; attract demo รันเองเป็นรอบ (title → demo → game-over → title)
- **กด Start ช่วง title** → เข้าเกม 1P จริง: ตัวละครควบคุมด้วยมือเรา
  (`right` เพิ่มตำแหน่ง X, `B` ลอยขึ้น, `A` เตะ/กระโดด — ยืนยันด้วยการเปรียบ OAM ระหว่างรันที่มี/ไม่มี input)
- เสียง APU ทำงานทั้งเฟส gameplay (pulse + sweep/envelope, tri, noise) — ตรวจแบบ headless ผ่าน
- ยังต้องทดสอบภาพ/เสียงใน browser จริงด้วยมือ (`npm run serve` + เปิด) — ความถูกต้องของ
  rendering/audio ยืนยันแบบ headless แล้วด้านล่างนี้