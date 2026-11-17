// ငွေ Transfer — squares the accounts below back onto their float: the admin its masters, a master
// its own agents and users, an agent its users.
//
// An account's float ("ထည့်ပေးထားသော ငွေ") is the money this very upline has handed it. Its balance
// then drifts with its tree's wins and losses. Pressing ငွေ Transfer puts every ticked account back
// onto that float — what sits over it is taken back, what is short is topped up. The squaring moves
// are left out of the float itself, so the float stays the same figure week after week (see
// src/routes/wallet.js).
//
// The weekly check boxes above the table are the days this upline does it on; today's name is
// marked, and a day that is not ticked only warns before the transfer goes through.
// A master / an agent pays the top-ups out of its own balance, so the server checks the whole round
// against it first.
import { api, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { badge, balanceCell, busy, confirmDialog, h, money, mount, pageHeader, table, toast } from '/common/js/ui.js';

// ISO weekdays: 1 = Monday … 7 = Sunday (JS getDay(): Sunday = 0).
const DAYS = [[1, 'တနင်္လာ'], [2, 'အင်္ဂါ'], [3, 'ဗုဒ္ဓဟူး'], [4, 'ကြာသပတေး'], [5, 'သောကြာ'], [6, 'စနေ'], [7, 'တနင်္ဂနွေ']];
const todayIso = () => new Date().getDay() || 7;

export default async function walletTransfer(main, { rerender }) {
  const { accounts, days } = await api.get('/wallet/float-targets');
  const role = session.get()?.user?.role;
  // What the list holds, by signed-in role: the admin's masters, a master's agents and users, an
  // agent's users.
  const whose = role === 'admin' ? 'Masters' : role === 'master' ? 'Agent / User' : 'Users';
  const masters = accounts;
  const picked = new Set();
  const today = todayIso();
  const chosen = new Set(days);

  // A master is squared up only when it has a float to go back on and is not already on it.
  const movable = (m) => m.float_amount > 0 && m.delta !== 0;

  const boxes = masters.map((m) => {
    const box = h('input', {
      type: 'checkbox', disabled: !movable(m),
      onchange: () => { if (box.checked) picked.add(m.id); else picked.delete(m.id); total(); },
    });
    return [m, box];
  });
  const all = h('input', {
    type: 'checkbox', title: 'အားလုံးရွေး', disabled: !boxes.some(([m]) => movable(m)),
    onchange: () => {
      for (const [m, box] of boxes) {
        if (!movable(m)) continue;
        box.checked = all.checked;
        if (all.checked) picked.add(m.id); else picked.delete(m.id);
      }
      total();
    },
  });

  const summary = h('span', { class: 'muted' });
  const transfer = h('button', { class: 'btn btn-primary', disabled: true }, '⇄ ငွေ Transfer လုပ်မည်');
  function total() {
    const rows = masters.filter((m) => picked.has(m.id));
    const up = rows.filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0);
    const down = rows.filter((m) => m.delta < 0).reduce((a, m) => a - m.delta, 0);
    transfer.disabled = rows.length === 0;
    summary.textContent = rows.length
      ? `ရွေးထား ${rows.length} ဦး · ပြန်ဖြည့် ${money(up)} · ပြန်နုတ် ${money(down)} ကျပ်`
      : 'အကောင့်ကို ရွေးပါ (ခေါင်းစဥ်က checkbox = အားလုံး)';
  }

  // The weekly check boxes: saved for the whole dashboard, so every admin sees the same days.
  const dayBoxes = DAYS.map(([iso, label]) => {
    const box = h('input', {
      type: 'checkbox', checked: chosen.has(iso),
      onchange: async () => {
        if (box.checked) chosen.add(iso); else chosen.delete(iso);
        await api.put('/wallet/float-days', { days: [...chosen] })
          .then(() => toast(chosen.size ? `ငွေ Transfer ရက်: ${DAYS.filter(([d]) => chosen.has(d)).map(([, l]) => l).join(', ')}` : 'ငွေ Transfer ရက် မရွေးထားပါ'),
            (e) => { box.checked = !box.checked; toast(e.message, 'bad'); });
      },
    });
    return h('label', { class: `check${iso === today ? ' check-today' : ''}`, style: 'margin:0' },
      box, h('span', { class: 'check-label' }, `${label}${iso === today ? ' (ယနေ့)' : ''}`));
  });

  async function run() {
    const rows = masters.filter((m) => picked.has(m.id));
    const up = rows.filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0);
    const down = rows.filter((m) => m.delta < 0).reduce((a, m) => a - m.delta, 0);
    const offDay = chosen.size > 0 && !chosen.has(today);
    const ok = await confirmDialog(
      [`အကောင့် ${rows.length} ဦးကို ထည့်ပေးထားသော ငွေအတိုင်း ပြန်ထားပါမည်။`,
        `ပိုသည် ပြန်နုတ် ${money(down)} ကျပ် · လျော့သည် ပြန်ဖြည့် ${money(up)} ကျပ်။`,
        offDay ? `⚠ ယနေ့ (${DAYS.find(([d]) => d === today)[1]}) သည် ရွေးထားသော ငွေ Transfer ရက် မဟုတ်ပါ။` : '',
      ].filter(Boolean).join('\n'),
      { title: 'ငွေ Transfer', confirmLabel: 'Transfer လုပ်မည်', danger: offDay });
    if (!ok) return;
    await busy(transfer, () => api.post('/wallet/float-reset', { user_ids: [...picked] })).then((r) => {
      toast(`${r.moved} ဦး ပြီးပါပြီ · ဖြည့် ${money(r.deposited)} · နုတ် ${money(r.withdrawn)} ကျပ်`);
      rerender();
    }, (e) => toast(e.message, 'bad'));
  }
  transfer.addEventListener('click', run);
  total();

  const action = (m) => {
    if (m.float_amount <= 0) return h('span', { class: 'muted' }, 'ထည့်ပေးထားသော ငွေ မရှိပါ');
    if (m.delta === 0) return h('span', { class: 'badge badge-good' }, '✓ အတိအကျ ရှိပြီး');
    return m.delta > 0
      ? h('b', { class: 'amount-pos' }, `ပြန်ဖြည့် ${money(m.delta)}`)
      : h('b', { class: 'amount-neg' }, `ပြန်နုတ် ${money(-m.delta)}`);
  };

  mount(main,
    pageHeader('ငွေ Transfer',
      [`${whose} တစ်ဦးချင်းကို ထည့်ပေးထားသော ငွေအတိုင်း ပြန်ထားပေးသည် — ပိုသည်ကို နုတ်၊ လျော့သည်ကို ဖြည့်။ `,
        role === 'admin' ? 'ထည့်ပေးထားသော ငွေ = ငွေသွင်း − ငွေထုတ်။ ' : 'ထည့်ပေးထားသော ငွေ = သင်ထည့်ပေးခဲ့သော ငွေ − ပြန်နုတ်ခဲ့သော ငွေ၊ ပြန်ဖြည့်ငွေကို သင့်လက်ကျန်မှ နုတ်ပါမည်။ ',
        'ဤ Transfer များကို ထည့်ပေးထားသော ငွေ တွက်ချက်ရာတွင် ထည့်မတွက်ပါ။'].join(''),
      h('a', { class: 'btn', href: '#/wallet' }, 'ငွေစာရင်း →')),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'ငွေ Transfer လုပ်မည့် ရက်များ (အပါတ်စဥ်)')),
      h('div', { class: 'actions', style: 'flex-wrap:wrap;gap:14px' }, dayBoxes),
      h('p', { class: 'muted', style: 'margin:10px 0 0' },
        chosen.size === 0
          ? 'ရက် မရွေးထားပါ — အချိန်မရွေး Transfer လုပ်နိုင်သည်။'
          : `ရွေးထားသော ရက်များ: ${DAYS.filter(([d]) => chosen.has(d)).map(([, l]) => l).join(', ')}${chosen.has(today) ? ' · ယနေ့ လုပ်ရမည့် ရက် ဖြစ်ပါသည်' : ' · ယနေ့ မပါဝင်ပါ'}`)),
    h('div', { class: 'card', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, summary, transfer),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `${whose} (${masters.length})`)),
      table(
        [
          { label: all, render: ([, box]) => box },
          { label: t('Username'), render: ([m]) => h('a', { href: `#/users/${m.id}` }, m.username) },
          { label: t('Name'), render: ([m]) => h('span', {}, m.name, m.name_mm ? h('div', { class: 'muted' }, m.name_mm) : null) },
          // A master's list holds both its agents and its users.
          role === 'master' && { label: '', render: ([m]) => badge(m.role) },
          { label: 'ထည့်ပေးထားသော ငွေ', align: 'right', render: ([m]) => money(m.float_amount) },
          { label: t('Balance'), align: 'right', render: ([m]) => balanceCell(m) },
          { label: 'လုပ်ရမည့်အလုပ်', align: 'right', render: ([m]) => action(m) },
        ].filter(Boolean),
        boxes,
        { empty: 'အကောင့် မရှိသေးပါ' })));
}
