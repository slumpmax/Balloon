# NES2JS — เล่นเกม NES หลายเกมบนเว็บ (6502 → JS, ไม่ใช้ emulator)

แปลงไฟล์ `.nes` (Mapper 0 / NROM) ให้เล่นในเบราว์เซอร์ โดย **แปลงทุกคำสั่ง 6502 ใน ROM เป็นโค้ด JavaScript จริง** แล้วเสริมชั้น runtime
ขั้นต่ำสำหรับ PPU / APU / ระบบหน่วยความจำ ซึ่งไม่สามารถตัดออกได้ — ปัจจุบันมีในระบบ:

| เกม | id |
|---|---|
| Balloon Fight (USA) | `balloon-fight-usa` |
| Nuts & Milk (Japan) | `nuts-milk-japan` |
| Baseball (USA, Europe) | `baseball-usa-europe` |
| Kinnikuman — Muscle Tag Match (Japan) | `kinnikuman-muscle-tag-match-japan` |
| Soccer (World) | `soccer-world` |

## ใช้งาน

```powershell
npm install          # (ไม่มี dependency — ได้แค่ convenience)
npm run build:bf     # แปลง Balloon Fight (build:nm/bb/km/sc = เกมอื่น ๆ)
npm run smoke        # ทดสอบ headless (เลือกเกมได้: node tools/smoke.cjs 300 soccer-world)
npm run export:sprites  # export ไทล์ CHR เป็น PNG sprite sheet (node tools/export-sprites.cjs <game-id>)
npm run export:hd      # ส่งออกฉาก + ตัวละคร HD (node tools/export-hd.cjs <game-id>, default balloon-fight-usa)
npm run serve        # รัน web server ที่พอร์ต 8080 แล้วเปิด http://localhost:8080
```

หน้าเว็บ: **เมนูเลือกเกมด้านซ้าย** (สไตล์ dialog เกม NES + thumbnail จากภาพ HD title) · จอเกมด้านขวา ·
ปุ่ม `1x / 2x / 4x / ⛶` ใต้จอ + **แผงควบคุม/สถานะใต้ปุ่ม** (กว้างเท่าจอพอดีทุกแถว) —
คีย์บอร์ด (อิง**ตำแหน่งปุ่มกายภาพ** `e.code` — กดติดเสมอไม่ว่าจะสลับภาษาคีย์บอร์ดเป็นอะไร):
ลูกศร = เลื่อน · `Z` = B · `X` = A · `Enter` = Start · `Shift` = Select ·
ผู้เล่น 2: `WASD` + `F`/`G`/`C`/`V` · `P` = หยุด · `R` = restart · `M` = เสียง (เปิดเป็นค่าเริ่มต้น — จะเล่นหลังกด/คลิกครั้งแรกตามนโยบายเบราว์เซอร์)

**เกมแพด (รองรับ 2 ตัว):** เสียบแล้วเล่นได้ทันที — แพดตัวแรก = ผู้เล่น 1, ตัวที่สอง = ผู้เล่น 2 ·
ปุ่ม **B = b0** · **A = b1** · **Select = b8** · **Start = b9** · ทิศทาง = dpad (b12-b15) หรือแกน analog

**คีย์ระบบ:** `H` สลับ 1x/2x/4x · `L` เต็มจอ · `Q` เต็มความกว้าง (ยุบแผงข้าง เหลือจอ+ปุ่ม) ·
`Tab` เปิดเมนูเลือกเกมด้วยคีย์บอร์ด (↑↓ เลื่อน, Enter สลับ, Esc ออก — NES ไม่ใช้ปุ่มพวกนี้ จึงไม่ชนกับตัวเกม) ·
หน้าจะ**จำค่าที่ตั้งไว้**ใน localStorage: เกมล่าสุด / โหมดจอ / เต็มกว้าง / เสียง

### จอเกม (HD เรียลไทม์)

เรนเดอร์ด้วย **Scale2x ในโดเมน palette-index แบบเรียลไทม์** (โค้ดเดียวกับ exporter) —
โหมด 1x/2x/4x มีความละเอียดภายในตามโหมด (256/512/1024 กว้าง) และขนาดแสดงผลย่อขยายตามหน้าต่าง
แบบ pixelated คงสัดส่วน 16:15 ของ NES เสมอ ทำงาน 60fps เพราะใช้ scratch buffer ใช้ซ้ำ (zero-alloc)

### เพิ่มเกมใหม่

1. วางไฟล์ `.nes` (NROM) ใน `roms/`
2. เพิ่ม script ใน `package.json`: `"build:xx": "node tools/nes2js.cjs public/game \"roms/<ไฟล์>.nes\""`
3. รัน `npm run build:<id>` แล้วเพิ่ม 1 บรรทัดใน `public/games.js` (globalKey = id uppercase เปลี่ยน `-` เป็น `_`)
4. (ทางเลือก) เพิ่ม config ของเกมใน `tools/export-hd.cjs` — ถ้ายังไม่ calibrate ตัวละครให้ใช้ `{ skipSprites: true, scenes: ['title'] }` จะได้ title.png + GIF สำหรับ thumbnail เมนู

> ตัวแปลง transpile **ทุก address ใน PRG** เป็น instruction (เหมือนที่ CPU 6502 ทำ — decode ได้จาก address ใดก็ได้)
> จึงไม่มี `unreachable state` แม้เกมจะใช้ jump table หรือกระโดดเข้ากลางคำสั่ง (NROM-128 mirror PC ช่วง $C000+ กลับ $8000 ให้เอง)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `tools/opcodes.cjs` | ตาราง opcode 6502 (ทุกโหมด, cycle) |
| `tools/nes2js.cjs` | parser iNES → emit JS (ทุก address = 1 instruction, dispatch ต่อ page 256 — เร็วแบบ jump table) |
| `tools/smoke.cjs` | เทสต์ headless + ASCII frame dump |
| `tools/png.cjs` | PNG encoder (RGBA) ใช้ร่วมทุก exporter — ไม่มี dependency |
| `tools/gif.cjs` | GIF89a + LZW encoder/decoder (มี round-trip self-test) |
| `tools/scaler.cjs` | Scale2x (AdvanceMAME) บน palette-index + nearest-neighbor บน RGBA |
| `tools/export-sprites.cjs` | export CHR tiles เป็น PNG sprite sheet + palette.json |
| `tools/export-hd.cjs` | ขับเกม headless → ฉาก HD 1024×960 + ตัวละครโปร่งใส + GIF attract demo |
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

## Export HD (ฉาก + ตัวละคร)

`npm run export:hd` ขับเกม headless ผ่านทุกฉาก (input จำลองผ่านตัวควบคุม) แล้วจับเฟรมจาก PPU ขยาย
ด้วย **Scale2x สองรอบ (4x → 1024×960)** ในโดเมน palette-index ก่อนแปลงเป็นสี — คมกริบระดับพิกเซล
ตัวละครตัดจาก OAM (composite 16×24 = 6 sprites) เป็น PNG โปร่งใสแยก pose ที่เกมวาดจริง ทั้งหมดเขียนด้วย
encoder PNG/GIF ในตัว (`tools/png.cjs`, `tools/gif.cjs` + round-trip LZW) ไม่เพิ่ม dependency

ผลลัพธ์ใน `public/game/hd/`:

| ไฟล์ | ความหมาย |
|---|---|
| `screenshots/title.png` | หน้า title "Balloon Fight" (1024×960) |
| `screenshots/gameplay-1p.png` | ฉากเล่น 1 คน (ผู้เล่นยืนบนแพลตฟอร์ม + HUD) |
| `screenshots/gameplay-2p.png` | ฉาก 2 คน (ผู้เล่น 2 กด Start เข้าร่วม) |
| `screenshots/balloon-trip.png` | โหมด Balloon Trip (Select ×2 → Start) |
| `screenshots/attract-demo.gif` | อนิเมชัน attract demo 512×480, ~20fps, วนลูป |
| `sprites/player1-*.png` / `player2-*.png` | ตัวละครผู้เล่นแยก pose (64×96 ต่อ pose, โปร่งใส) + sheet รวม |
| `sprites/enemy-*.png` | ศัตรู/ฝูงบนแพลตฟอร์มแยก pose + sheet รวม |
| `manifest.json` | รายการไฟล์ + OAM tiles ของแต่ละ pose |

## Export sprite

`npm run export:sprites` อ่าน 8KB CHR จาก ROM แล้ว decode ทุก 256 ไทล์ (2 pattern table × 128)
เป็น PNG ลง `public/game/sprites/` — ระบายสีด้วย palette กับพื้นจริงที่เกมโหลดเองลง PPU ระหว่างรัน:

| ไฟล์ | ความหมาย |
|---|---|
| `*-table0-sprite.png` / `*-table1-sprite.png` | ไทล์ทั้ง 128 ตัว × 4 sub-palette ของ sprite palettes ($3F11-$3F1F) |
| `*-table0-bg.png` / `*-table1-bg.png` | แบบเดียวกัน แต่ใช้ background palettes ($3F01-$3F0F) |
| `palette.json` | รายการสี backdrop/bg/sprite ที่จับได้ตอน headless |

Layout แต่ละไฟล์: แถวละ 16 ไทล์ สูง 8 ไทล์, แยกเป็น 4 บล็อกตาม sub-palette (0-3) — ไทล์
สไปรต์จริง (บอลลูน, นักบิน ฯลฯ) ส่วนใหญ่อยู่ช่วงต้น table0 ครับ