import { api } from '/common/js/api.js';
import { h, mount, pageHeader, toast } from '/common/js/ui.js';

export default async function masterSettings(main) {
  let settings = {};
  try { settings = await api.get('/master-settings'); } catch (_) {}

  async function save(patch) {
    try {
      settings = await api.put('/master-settings', patch);
      toast('သိမ်းပြီးပါပြီ ✓', 'good');
    } catch (e) {
      toast(`မသိမ်းနိုင်ပါ: ${e.message ?? e}`, 'bad');
    }
  }

  // Toggle switch row: icon · title + hint · switch
  function switchRow(key, icon, title, hint) {
    const on = settings[key] === true;
    const track = h('span', { class: `sw-track${on ? ' sw-on' : ''}` },
      h('span', { class: 'sw-thumb' }));
    const row = h('div', { class: 'sw-row', onclick: () => {
      const next = !track.classList.contains('sw-on');
      track.classList.toggle('sw-on', next);
      save({ [key]: next });
    }},
      h('span', { class: 'sw-icon' }, icon),
      h('span', { class: 'sw-text' },
        h('span', { class: 'sw-title' }, title),
        hint && h('span', { class: 'sw-hint' }, hint),
      ),
      track,
    );
    return row;
  }

  // Radio option row
  function radioRow(name, value, currentValue, label, hint) {
    const inp = h('input', { type: 'radio', name, value });
    inp.checked = currentValue === value;
    inp.addEventListener('change', () => inp.checked && save({ user_wallet_display: value }));
    return h('label', { class: 'radio-row' },
      inp,
      h('span', { class: 'radio-dot' }),
      h('span', { class: 'sw-text' },
        h('span', { class: 'sw-title' }, label),
        hint && h('span', { class: 'sw-hint' }, hint),
      ),
    );
  }

  const walletVal = settings.user_wallet_display === 'master' ? 'master' : 'upline';

  mount(main,
    pageHeader('Settings', 'Master account ဆက်တင်များ'),
    h('div', { class: 'settings-grid' },

      h('div', { class: 'settings-card' },
        h('div', { class: 'settings-card-head' },
          h('span', { class: 'settings-card-icon' }, '👥'),
          h('div', {},
            h('h2', {}, 'Agent ခွင့်ပြုချက်များ'),
            h('p', { class: 'muted' }, 'Agent တွေကို ဘာတွေ ပြင်ခွင့်ပေးမလဲ'),
          ),
        ),
        h('div', { class: 'settings-rows' },
          switchRow('allow_agent_commission', '💰', 'ကော်မရှင် ပြင်ခွင့်', 'Agent တွေ ကိုယ်ပိုင် commission rate သတ်မှတ်နိုင်မည်'),
          switchRow('allow_prize_assign', '🏅', 'အလျော်အဆတွဲ ခွင့်ပြု', 'Agent တွေ prize set သတ်မှတ်ပေးနိုင်မည်'),
        ),
      ),

      h('div', { class: 'settings-card' },
        h('div', { class: 'settings-card-head' },
          h('span', { class: 'settings-card-icon' }, '🎰'),
          h('div', {},
            h('h2', {}, 'ထိုးသားများ ဆက်တင်'),
            h('p', { class: 'muted' }, 'User app မြင်ရသည့် အချက်အလက်များ'),
          ),
        ),
        h('div', { class: 'settings-rows' },
          switchRow('allow_name_edit', '🏪', 'ဆိုင်အမည် ပြောင်းခွင့်', 'User တွေ ကိုယ်ပိုင် ဆိုင်အမည် (slip header) ပြင်နိုင်မည်'),
        ),
        h('div', { class: 'settings-section-label' }, 'Wallet ပြသည့် ပုံစံ'),
        h('div', { class: 'settings-rows radio-group' },
          radioRow('wallet_display', 'upline', walletVal,
            'Upline Wallet (ပုံမှန်)',
            'User → Agent wallet · Agent → Master wallet မြင်ရမည်'),
          radioRow('wallet_display', 'master', walletVal,
            'Master Wallet',
            'User အားလုံး master wallet နံပါတ်တစ်ခုတည်း မြင်ရမည်'),
        ),
      ),

    ),
    h('style', {}, STYLES),
  );
}

const STYLES = `
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
  max-width: 900px;
}
.settings-card {
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 12px;
  overflow: hidden;
}
.settings-card-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
}
.settings-card-icon {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}
.settings-card-head h2 {
  margin: 0 0 2px;
  font-size: 15px;
  font-weight: 600;
}
.settings-card-head p {
  margin: 0;
  font-size: 12px;
}
.settings-section-label {
  padding: 10px 20px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--color-muted, #888);
}
.settings-rows { padding: 6px 0; }
.sw-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 20px;
  cursor: pointer;
  user-select: none;
  transition: background .12s;
}
.sw-row:hover { background: var(--color-hover, rgba(0,0,0,.04)); }
.sw-icon { font-size: 18px; flex-shrink: 0; width: 24px; text-align: center; }
.sw-text { flex: 1; min-width: 0; }
.sw-title { display: block; font-size: 14px; font-weight: 500; }
.sw-hint { display: block; font-size: 12px; color: var(--color-muted, #888); margin-top: 1px; }
/* Toggle switch */
.sw-track {
  flex-shrink: 0;
  width: 44px; height: 24px;
  border-radius: 12px;
  background: var(--color-border, #d1d5db);
  position: relative;
  transition: background .2s;
}
.sw-track.sw-on { background: var(--color-primary, #2563eb); }
.sw-thumb {
  position: absolute;
  top: 3px; left: 3px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.2);
  transition: transform .2s;
}
.sw-track.sw-on .sw-thumb { transform: translateX(20px); }
/* Radio rows */
.radio-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 20px;
  cursor: pointer;
  user-select: none;
  transition: background .12s;
}
.radio-row:hover { background: var(--color-hover, rgba(0,0,0,.04)); }
.radio-row input[type=radio] { display: none; }
.radio-dot {
  flex-shrink: 0;
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid var(--color-border, #d1d5db);
  background: transparent;
  position: relative;
  transition: border-color .15s;
}
.radio-row input:checked + .radio-dot {
  border-color: var(--color-primary, #2563eb);
  background: var(--color-primary, #2563eb);
}
.radio-row input:checked + .radio-dot::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: #fff;
}
`;
