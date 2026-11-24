(() => {
  const canvas = document.getElementById('cat');
  const pen = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // Each character is one white pixel. Empty cells show the workspace behind the cat.
  const sleeping = [
    '        #######          ',
    '      ##       ##   #  # ',
    '     #           # ## ## ',
    '    #             ## # # ',
    '   #            ##     # ',
    '   #      ###  #        #',
    '    #   ##   # #  -- -- #',
    '     ###    #   #   v  # ',
    '        ######### #####  '
  ];
  const walking = [
    '                 #   #   ',
    '   ##            ## ##   ',
    '  #  #           # # #   ',
    '  #   ###########     #  ',
    '   # #             #  ###',
    '    ##                #  ',
    '     #            ####   ',
    '      #  #######  #      '
  ];
  let position = 4, direction = 1, tick = 0, working = false, looking = 0;
  function draw() {
    const width = Math.max(32, Math.floor(canvas.clientWidth / 2));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== 28) canvas.height = 28;
    const edge = width - 27;
    position = Math.max(1, Math.min(position, edge));
    const awake = working || looking > 0;
    const stride = working && !looking && tick % 66 < 51 && !reduced.matches;
    if (stride) {
      position += direction * 2;
      if (position >= edge || position <= 1) direction *= -1;
      position = Math.max(1, Math.min(position, edge));
    }
    pen.clearRect(0, 0, width, 28);
    for (let i = 0; i < width / 20; i++) {
      pen.fillStyle = (i + Math.floor(tick / 8)) % 6 === 0 ? '#777' : '#333';
      pen.fillRect((i * 71 + 9) % width, (i * 13 + 3) % 22, 1, 1);
    }
    pen.fillStyle = '#fff';
    const legs = stride && tick % 4 < 2 ? ['     #  #     #  #','     ###      ###'] : ['       # #      # #','       ###      ###'];
    const sprite = awake ? walking.concat(legs) : sleeping;
    const face = awake && !stride && tick % 32 < 8 ? -direction : direction;
    sprite.forEach((row,y) => [...row].forEach((cell,x) => {
      if (cell !== ' ') pen.fillRect(position + (face > 0 ? x : 24 - x), 13 + y, 1, 1);
    }));
    if (looking > 0) looking--;
    if (!reduced.matches) tick++;
  }
  window.catWorking = value => { working = value; draw(); };
  function look(event) {
    direction = event.clientX / 2 - canvas.getBoundingClientRect().left / 2 > position ? 1 : -1;
    looking = 12; draw();
  }
  canvas.addEventListener('pointerdown', look);
  document.getElementById('pet').addEventListener('click', () => { direction = 1; looking = 20; draw(); });
  document.getElementById('task').addEventListener('focus', () => { looking = 9; draw(); });
  setInterval(() => { if (!document.hidden) draw(); }, 160);
  draw();
})();
