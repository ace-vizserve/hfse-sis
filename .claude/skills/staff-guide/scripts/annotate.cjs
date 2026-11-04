// Screenshot helpers for a guide's capture script: red numbered labels with an
// arrow and a ring around the thing they point at, drawn on the live page.
//
//   const { signIn, shot, hideDevTools } = require('<repo>/.claude/skills/staff-guide/scripts/annotate.cjs');
//   await shot(page, `${OUT}/01-list.png`, [
//     { target: page.getByRole('button', { name: 'New event' }), label: 'Start a new event.', side: 'left' },
//   ]);
//
// A note: { target, label, side?: 'left'|'right'|'top'|'bottom', gap?, dx?, dy?, width? }.
// Use side, gap, dx and dy to move a label off whatever it would cover.
const RED = '#E11D48';

async function annotate(page, notes) {
  const boxes = [];
  for (const n of notes) {
    const b = await n.target.first().boundingBox({ timeout: 3000 }).catch(() => null);
    if (!b) {
      throw new Error(`Nothing on the page for the label "${n.label}"`);
    }
    const { target, ...rest } = n;
    boxes.push({ ...rest, b });
  }
  await page.evaluate(
    ({ items, RED }) => {
      document.querySelectorAll('.zz-ann').forEach((e) => e.remove());
      const W = window.innerWidth;
      const H = window.innerHeight;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'zz-ann');
      svg.setAttribute('width', String(W));
      svg.setAttribute('height', String(H));
      Object.assign(svg.style, { position: 'fixed', inset: '0', zIndex: 2147483646, pointerEvents: 'none' });
      svg.innerHTML = `<defs><marker id="zzh" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${RED}"/></marker></defs>`;
      document.body.appendChild(svg);
      items.forEach((it, i) => {
        const { b } = it;
        const ring = document.createElement('div');
        ring.className = 'zz-ann';
        Object.assign(ring.style, {
          position: 'fixed',
          left: `${b.x - 4}px`,
          top: `${b.y - 4}px`,
          width: `${b.width + 8}px`,
          height: `${b.height + 8}px`,
          border: `3px solid ${RED}`,
          borderRadius: '8px',
          zIndex: 2147483646,
          pointerEvents: 'none',
        });
        document.body.appendChild(ring);

        const box = document.createElement('div');
        box.className = 'zz-ann';
        const num = document.createElement('b');
        num.textContent = String(i + 1);
        Object.assign(num.style, {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
          width: '22px',
          height: '22px',
          marginRight: '8px',
          borderRadius: '999px',
          background: '#fff',
          color: RED,
          font: '700 13px/1 system-ui, sans-serif',
        });
        const text = document.createElement('span');
        text.textContent = it.label;
        box.append(num, text);
        Object.assign(box.style, {
          position: 'fixed',
          display: 'flex',
          alignItems: 'flex-start',
          maxWidth: `${it.width || 300}px`,
          background: RED,
          color: '#fff',
          font: '600 14px/1.35 system-ui, sans-serif',
          padding: '10px 12px',
          borderRadius: '6px',
          boxShadow: '0 4px 14px rgba(0,0,0,.25)',
          zIndex: 2147483647,
          pointerEvents: 'none',
        });
        document.body.appendChild(box);

        const bw = box.offsetWidth;
        const bh = box.offsetHeight;
        const gap = it.gap ?? 70;
        const side = it.side || 'left';
        let x = 0;
        let y = 0;
        if (side === 'left') {
          x = b.x - bw - gap;
          y = b.y + b.height / 2 - bh / 2;
        }
        if (side === 'right') {
          x = b.x + b.width + gap;
          y = b.y + b.height / 2 - bh / 2;
        }
        if (side === 'top') {
          x = b.x + b.width / 2 - bw / 2;
          y = b.y - bh - gap;
        }
        if (side === 'bottom') {
          x = b.x + b.width / 2 - bw / 2;
          y = b.y + b.height + gap;
        }
        x += it.dx || 0;
        y += it.dy || 0;
        x = Math.max(8, Math.min(W - bw - 8, x));
        y = Math.max(8, Math.min(H - bh - 8, y));
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;

        const bx = x + bw / 2;
        const by = y + bh / 2;
        const tx = Math.max(b.x, Math.min(bx, b.x + b.width));
        const ty = Math.max(b.y, Math.min(by, b.y + b.height));
        const sx = Math.max(x, Math.min(tx, x + bw));
        const sy = Math.max(y, Math.min(ty, y + bh));
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(sx));
        line.setAttribute('y1', String(sy));
        line.setAttribute('x2', String(tx + (sx < tx ? -6 : sx > tx ? 6 : 0)));
        line.setAttribute('y2', String(ty + (sy < ty ? -6 : sy > ty ? 6 : 0)));
        line.setAttribute('stroke', RED);
        line.setAttribute('stroke-width', '3');
        line.setAttribute('marker-end', 'url(#zzh)');
        svg.appendChild(line);
      });
    },
    { items: boxes, RED }
  );
}

const clear = (page) => page.evaluate(() => document.querySelectorAll('.zz-ann').forEach((e) => e.remove()));

// Hides the Next.js dev button, which otherwise lands in the corner of every shot.
const hideDevTools = (page) =>
  page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});

async function shot(page, file, notes = []) {
  await hideDevTools(page);
  await annotate(page, notes);
  await page.screenshot({ path: file });
  await clear(page);
}

async function signIn(page, baseUrl, email, password = 'local.test') {
  await page.goto(`${baseUrl}/login`, { timeout: 120000 });
  await page.getByPlaceholder('you@hfse.edu.sg').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000 });
}

module.exports = { annotate, clear, hideDevTools, shot, signIn };
