# Online Lotto Print Agent

Browser များသည် စက်ထဲရှိ printer များကို မမြင်နိုင်ပါ။ ဤ program ကို user ၏ Windows စက်ပေါ်တွင် run ထားလျှင်
online web ၏ **Slip Printer Settings** select box တွင် ဤစက်၏ printer list ပေါ်လာပြီး ရွေးထားသော printer သို့
dialog မပေါ်ဘဲ တိုက်ရိုက် ပရင့်ထုတ်နိုင်ပါသည်။ (Browsers cannot see local printers; this agent lists them and
prints slips directly. Printing never goes through the online server.)

## Install (တစ်ကြိမ်သာ)

1. Node.js (LTS) ကို https://nodejs.org မှ install လုပ်ပါ။
2. ဤ `print-agent` folder တစ်ခုလုံးကို user စက်ထဲ copy ကူးပါ (ဥပမာ `C:\OnlineLottoPrintAgent`)။
3. `start-print-agent.bat` ကို double-click နှိပ်ပါ။ Window တွင် `Printers: ...` ဟု printer များ ပေါ်လာပါမည်။
   ဤ window ကို ဖွင့်ထားရပါမည်။

## Windows ဖွင့်တိုင်း အလိုအလျောက် run ရန်

`Win + R` → `shell:startup` → ပွင့်လာသော folder ထဲသို့ `start-print-agent.bat` ၏ **shortcut** ကို ထည့်ပါ။

## Online web တွင်

Agent ကို run ထားပြီးမှ **Slip Printer Settings** ကို ဖွင့်ပါ → **Slip Printer** select box တွင် printer ကို ရွေးပါ →
**Test Print**။ (Settings ဖွင့်တိုင်း printer list ကို `http://localhost:3010` မှ အလိုအလျောက် ရှာပါသည်။)

## Notes

- `127.0.0.1` (ဤစက်) တွင်သာ နားထောင်ပါသည်။ ဤစက်/LAN နှင့် `*.onrender.com` web page များသာ သုံးခွင့်ရှိသည်။
  အခြား domain ဖြင့် သုံးလျှင် `PRINT_AGENT_ORIGINS=https://your-domain` ထည့်ပါ (`*` = အားလုံး)။
- Port ပြောင်းရန် `PRINT_AGENT_PORT` (default 3010)။
- Chrome တွင် public site (Render) မှ localhost သို့ ပထမဆုံး ချိတ်သည့်အခါ ခွင့်ပြုချက် မေးနိုင်ပါသည် — Allow နှိပ်ပါ။
