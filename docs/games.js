/* games.js — registry รายชื่อเกมที่มีในระบบ
 * เพิ่มเกมใหม่: (1) npm run build:<id> (2) เพิ่ม 1 บรรทัดในนี้
 * globalKey ต้องตรงกับที่ตัวแปลง derive (id uppercase, '-' -> '_')
 */
(function (g) {
  'use strict';
  g.NES_GAMES = [
    { id: 'balloon-fight-usa', title: 'Balloon Fight', romFile: 'balloon-fight-usa/balloon-fight-usa.rom.js', globalKey: 'BALLOON_FIGHT_USA', shot: 'game/balloon-fight-usa/hd/screenshots/title.png' },
    { id: 'nuts-milk-japan', title: 'Nuts & Milk', romFile: 'nuts-milk-japan/nuts-milk-japan.rom.js', globalKey: 'NUTS_MILK_JAPAN', shot: 'game/nuts-milk-japan/hd/screenshots/title.png' },
    { id: 'baseball-usa-europe', title: 'Baseball', romFile: 'baseball-usa-europe/baseball-usa-europe.rom.js', globalKey: 'BASEBALL_USA_EUROPE', shot: 'game/baseball-usa-europe/hd/screenshots/title.png' },
    { id: 'kinnikuman-muscle-tag-match-japan', title: 'Kinnikuman Muscle Tag Match', romFile: 'kinnikuman-muscle-tag-match-japan/kinnikuman-muscle-tag-match-japan.rom.js', globalKey: 'KINNIKUMAN_MUSCLE_TAG_MATCH_JAPAN', shot: 'game/kinnikuman-muscle-tag-match-japan/hd/screenshots/title.png' },
    { id: 'soccer-world', title: 'Soccer', romFile: 'soccer-world/soccer-world.rom.js', globalKey: 'SOCCER_WORLD', shot: 'game/soccer-world/hd/screenshots/title.png' },
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
