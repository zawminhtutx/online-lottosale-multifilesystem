import { api } from '/common/js/api.js';
import { field, h, mount, pageHeader } from '/common/js/ui.js';

export default async function masterSettings(main) {
  let settings = {};
  try { settings = await api.get('/master-settings'); } catch (_) {}

  const toggle = (key, label, hint) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = settings[key] === true;
    const wrap = field(label,
      h('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' },
        cb, h('span', { style: 'font-size:13px;color:var(--color-muted,#666)' }, hint)),
    );
    cb.addEventListener('change', () => save({ [key]: cb.checked }));
    return wrap;
  };

  const walletGroup = (() => {
    const upline = h('input', { type: 'radio', name: 'wallet_display', value: 'upline' });
    const master = h('input', { type: 'radio', name: 'wallet_display', value: 'master' });
    upline.checked = settings.user_wallet_display !== 'master';
    master.checked = settings.user_wallet_display === 'master';
    const onChange = () => save({ user_wallet_display: master.checked ? 'master' : 'upline' });
    upline.addEventListener('change', onChange);
    master.addEventListener('change', onChange);
    return field('User Wallet Display',
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, upline,
          h('span', {}, 'မိမိ Upline Wallet (ပုံမှန်) — User→Agent, Agent→Master wallet မြင်ရမည်')),
        h('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, master,
          h('span', {}, 'Master Wallet — User အားလုံး master wallet နံပါတ်မြင်ရမည်')),
      )
    );
  })();

  const msg = h('p', { style: 'color:var(--color-success,green);min-height:1.4em;font-size:13px' });

  async function save(patch) {
    try {
      settings = await api.put('/master-settings', patch);
      msg.textContent = 'သိမ်းပြီးပါပြီ ✓';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    } catch (e) {
      msg.style.color = 'red';
      msg.textContent = `${e}`;
    }
  }

  mount(main,
    pageHeader('Settings', 'Master account ဆက်တင်များ'),
    h('div', { class: 'card', style: 'max-width:640px' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Agent ခွင့်ပြုချက်များ')),
      toggle('allow_agent_commission', 'Agent ကော်မရှင် ပြင်ခွင့်', 'Agent တွေ ကိုယ်ပိုင် commission ပြင်နိုင်မည်'),
      toggle('allow_prize_assign', 'အလျော်အဆတွဲ ခွင့်ပြု', 'Agent တွေ prize set သတ်မှတ်ပေးနိုင်မည်'),
    ),
    h('div', { class: 'card', style: 'max-width:640px;margin-top:16px' },
      h('div', { class: 'card-head' }, h('h2', {}, 'ထိုးသားများ ဆက်တင်')),
      walletGroup,
      toggle('allow_name_edit', 'User ဆိုင်အမည် ပြောင်းခွင့်', 'User တွေ ကိုယ်ပိုင် ဆိုင်အမည် (slip header) ပြင်နိုင်မည်'),
    ),
    msg,
  );
}
