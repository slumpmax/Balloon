/* Graphics + metadata resources extracted from Soccer (World).nes */
(function (g) {
  var ROM = g['SOCCER_WORLD'] || (g['SOCCER_WORLD'] = {});
  ROM.resources = {
    chr: ROM.chr,                          // 8192 bytes CHR ROM = graphics data
    palettes: 'embedded in runtime',       // PPU palette RAM is runtime state
    sprites: 'OAM runtime state',
    tiles: { w: ROM.chr.length / 8 / 2, spriteTiles: ROM.chr.length / 8 },
    note: 'CHR pattern tables loaded into PPU VRAM $0000-$1FFF'
  };
  if (typeof module !== 'undefined') module.exports = g['SOCCER_WORLD'];
})(typeof globalThis !== 'undefined' ? globalThis : this);
