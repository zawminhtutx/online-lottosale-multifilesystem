using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.Views;

namespace OnlineLotto.Wpf.ViewModels;

public enum FocusTarget { Number, Unit, Customer }

public partial class CartRow : ObservableObject
{
    public string RowId { get; init; } = Guid.NewGuid().ToString("n");
    public int BetTypeId { get; init; }
    public string Type { get; init; } = "";
    public string Input { get; set; } = "";
    public List<string> NumberList { get; set; } = [];
    public int Unit { get; init; }
    public string Discount => "0";
    public string Status { get; set; } = "ကျံ";
    public bool Over { get; set; }
    public bool IsChild { get; init; }
    public string? ParentRowId { get; init; }
    public bool CanRemove => !IsChild;
    public bool IsGroup => NumberList.Count > 1;
    public bool HasMany => IsGroup;
    [ObservableProperty] bool _expanded;
    public string Numbers => IsChild ? string.Join("", NumberList) : Input;
    partial void OnExpandedChanged(bool value) => OnPropertyChanged(nameof(Numbers));
    public string Detail => $"{Input} {Unit}";
}

public sealed class HoldTab
{
    public string Title { get; init; } = "";
    public List<CartRow> Rows { get; init; } = [];
}

public sealed class LedgerRow
{
    public string Number { get; init; } = "";
    public decimal UnitValue { get; init; }
    public decimal ExtraValue { get; init; }
    public string Unit => UnitValue.ToString("N0");
    public string Extra => ExtraValue.ToString("N0");
    public string State { get; init; } = "";
}

public partial class SaleViewModel : ObservableObject
{
    readonly Session _session;

    public event Action<FocusTarget>? FocusRequested;
    public event Action<CartRow>? CartScrollRequested;

    public ObservableCollection<UserDto> Customers { get; } = [];
    public ObservableCollection<BetTypeDto> Types { get; } = [];
    public ObservableCollection<CartRow> CartRows { get; } = [];
    public ObservableCollection<LedgerRow> LedgerRows { get; } = [];
    public ObservableCollection<HoldTab> HoldTabs { get; } = [];

    [ObservableProperty] UserDto? _selectedCustomer;
    [ObservableProperty] TermDto? _selectedTerm;
    [ObservableProperty] BetTypeDto? _ledgerType;
    [ObservableProperty] string _customerId = "";
    [ObservableProperty] string _numberText = "";
    [ObservableProperty] string _unitText = "";
    [ObservableProperty] string _discountText = "0";
    [ObservableProperty] bool _sequentialMode;
    [ObservableProperty] bool _rMode;
    [ObservableProperty] bool _uMode;
    [ObservableProperty] bool _autoMode;
    [ObservableProperty] string _activeTypeKey = "2D";
    [ObservableProperty] string _numberHint = "နှစ်လုံး";
    [ObservableProperty] string _previewNumbers = "";
    [ObservableProperty] string _previewKind = "ကျံ";
    [ObservableProperty] string _previewUnits = "0";
    [ObservableProperty] bool _previewOver;
    [ObservableProperty] string _slipBanner = "";
    [ObservableProperty] string _message = "";
    [ObservableProperty] bool _messageIsError;
    [ObservableProperty] bool _printOnCheckout;
    [ObservableProperty] bool _extraSave;
    [ObservableProperty] bool _liveConnected = true;
    [ObservableProperty] CartRow? _selectedCartRow;
    [ObservableProperty] LedgerRow? _selectedLedgerRow;
    [ObservableProperty] HoldTab? _selectedHoldTab;
    [ObservableProperty] string _ledgerSort = "num";

    public bool IsBuy { get; }
    public bool IsSale => !IsBuy;
    public bool IsFourD => false;
    public string BetMode { get => "B"; set { } }
    public bool CanDiscount => false;
    public bool CanAddCustomer => false;
    public bool CanEditTerm => _session.IsBook;
    public bool ShowBreakTools => _session.IsBook;
    public bool CanPickCustomer => _session.IsUpline;
    public bool CanExtraSave => _session.IsBook || (_session.IsUpline && _session.User.SaleOver == 1);
    public bool IsSendOn => false;
    public string SendChannel => "";
    public bool CustomerIsDealer => false;
    public bool HasHolds => HoldTabs.Count > 0;
    public string CustomerName => SelectedCustomer?.Username ?? "";
    public string CustomerStatus => SelectedCustomer is null ? "" :
        $"{SelectedCustomer.Username}  {SelectedCustomer.Balance:N0}{(SelectedCustomer.Unlimited == 1 ? " ∞" : "")}";
    public string CartUnits => CartRows.Where(r => !r.IsChild).Sum(r => r.Unit * Math.Max(1, r.NumberList.Count)).ToString("N0");
    public string CartTotal => (CartRows.Where(r => !r.IsChild).Sum(r => r.Unit * Math.Max(1, r.NumberList.Count)) * (SelectedTerm?.UnitPrice ?? 0)).ToString("N0");
    public string CartCount => CartRows.Count(r => !r.IsChild).ToString();
    public string LedgerAll { get; private set; } = "0";
    public string LedgerExtra { get; private set; } = "0";
    public string LedgerNet { get; private set; } = "0";
    public string LedgerPct { get; private set; } = "0%";

    public SaleViewModel(Session session, bool buy = false)
    {
        _session = session;
        IsBuy = buy;
        _session.WorkspaceChanged += OnWorkspaceChanged;
    }

    void OnWorkspaceChanged()
    {
        var t = _session.ActiveTerm;
        if (t is null || _applyingTerm) return;
        if (SelectedTerm?.Id == t.Id) return;
        _ = ApplyTermAsync(t);
    }

    public async Task LoadAsync()
    {
        try
        {
            var metaTask = _session.Api.GetAsync<MetaDto>("api/meta");
            Task<List<UserDto>>? customersTask = _session.IsUpline
                ? _session.Api.GetAsync<List<UserDto>>("api/users?role=user")
                : null;
            await metaTask;
            if (customersTask is not null) await customersTask;
            var meta = metaTask.Result;
            Customers.Clear();
            if (_session.IsUser) Customers.Add(_session.User);
            else if (customersTask?.Result is { } customers)
                foreach (var u in customers.Where(x => x.Status == "active")) Customers.Add(u);
            Types.Clear();
            foreach (var bt in meta.BetTypes.Where(b => b.IsActive != 0)) Types.Add(bt);
            SelectedCustomer = Customers.FirstOrDefault();
            CustomerId = SelectedCustomer?.Username ?? "";
            var pick = _session.ActiveTerm
                ?? _session.FolderTerms.FirstOrDefault(t => t.Status == "open")
                ?? (_session.IsUser ? null : _session.FolderTerms.FirstOrDefault());
            if (pick is not null) await ApplyTermAsync(pick);
            else PickFirstType();
        }
        catch (ApiException ex) { Show(ex.Message, true); }
    }

    void PickFirstType()
    {
        var game = SelectedTerm?.Game ?? "2D";
        var want = game.Contains('3') ? 3 : 2;
        var bt = Types.FirstOrDefault(t => t.Digits == want) ?? Types.FirstOrDefault();
        if (bt is null) return;
        ActiveTypeKey = bt.Code;
        LedgerType = bt;
        NumberHint = EntryParser.Hint("", bt.Digits);
        OnPropertyChanged(nameof(CanExtraSave));
    }

    int Digits() => CurrentType()?.Digits ?? 2;
    BetTypeDto? CurrentType() => Types.FirstOrDefault(t => t.Code.Equals(ActiveTypeKey, StringComparison.OrdinalIgnoreCase)) ?? LedgerType;
    BetTypeDto? ViewType() => LedgerType ?? CurrentType();

    decimal BreakCap() => BreakCap(CurrentType());

    decimal BreakCap(BetTypeDto? bt)
    {
        if (_session.IsUser || bt is null || SelectedTerm is null) return 0;
        return SelectedTerm.Limits.FirstOrDefault(l => l.BetTypeId == bt.Id)?.MaxUnits ?? 0;
    }

    [RelayCommand]
    void PickType(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return;
        ActiveTypeKey = code;
        LedgerType = Types.FirstOrDefault(t => t.Code.Equals(code, StringComparison.OrdinalIgnoreCase));
        NumberHint = EntryParser.Hint(NumberText, Digits());
        FocusRequested?.Invoke(FocusTarget.Number);
    }

    partial void OnLedgerTypeChanged(BetTypeDto? value)
    {
        if (_applyingTerm) return;
        _ = RefreshSlipAndLedgerAsync();
    }

    partial void OnNumberTextChanged(string value)
    {
        NumberHint = EntryParser.Hint(value, Digits());
        var parsed = EntryParser.Parse(value, Digits(), RMode);
        PreviewNumbers = parsed.Error is null && parsed.Numbers.Count > 1 ? string.Join(" ", parsed.Numbers) : "";
        if (AutoMode && !UMode && parsed.Error is null && parsed.Numbers.Count > 0)
            FocusRequested?.Invoke(FocusTarget.Unit);
    }

    partial void OnSelectedCustomerChanged(UserDto? value)
    {
        CustomerId = value?.Username ?? "";
        OnPropertyChanged(nameof(CustomerName));
        OnPropertyChanged(nameof(CustomerStatus));
        _ = RefreshSlipAndLedgerAsync();
    }

    bool _applyingTerm;

    partial void OnSelectedTermChanged(TermDto? value)
    {
        if (_applyingTerm || value is null) return;
        _ = ApplyTermAsync(value);
    }

    async Task ApplyTermAsync(TermDto listed)
    {
        try
        {
            var full = await _session.Api.GetAsync<TermDto>($"api/terms/{listed.Id}");
            _applyingTerm = true;
            SelectedTerm = full;
            _applyingTerm = false;
            _session.SetActiveTerm(full);
            PickFirstType();
            await RefreshSlipAndLedgerAsync();
            OnPropertyChanged(nameof(CartTotal));
        }
        catch (ApiException ex) { Show(ex.Message, true); }
        finally { _applyingTerm = false; }
    }

    [RelayCommand]
    void Add() => AddLine();

    public int LedgerDigits => ViewType()?.Digits ?? Digits();

    public string? RestReverseOfLast()
    {
        var last = CartRows.FirstOrDefault(r => !r.IsChild && r.NumberList.Count == 1);
        return last is null ? null : last.NumberList[0] + "RR";
    }

    public void AddRToNumber()
    {
        var n = NumberText.Trim();
        if (n.Length > 0 && !n.EndsWith('R')) NumberText = n + "R";
    }

    public bool SelectLedgerByTyped(string typed)
    {
        var row = LedgerRows.FirstOrDefault(r => r.Number.StartsWith(typed, StringComparison.Ordinal));
        if (row is null) return false;
        SelectedLedgerRow = row;
        return true;
    }

    public void RemoveRows(IEnumerable<string> ids)
    {
        foreach (var id in ids.Distinct().ToList()) RemoveRow(id);
    }

    public void AddLine()
    {
        var bt = CurrentType();
        if (bt is null || SelectedTerm is null) { Show("အပါတ်စဥ် ရွေးပါ", true); return; }
        if (!int.TryParse(UnitText, out var unit) || unit <= 0) { Show("ယူနစ် ထည့်ပါ", true); FocusRequested?.Invoke(FocusTarget.Unit); return; }
        var parsed = EntryParser.Parse(NumberText, bt.Digits, RMode);
        if (parsed.Error is not null) { Show(parsed.Error, true); FocusRequested?.Invoke(FocusTarget.Number); return; }
        var input = EntryParser.Normalize(NumberText.Trim());
        if (RMode && input.All(char.IsDigit)) input += "R";
        var row = new CartRow
        {
            BetTypeId = bt.Id,
            Type = bt.Code,
            Input = input,
            NumberList = parsed.Numbers.ToList(),
            Unit = unit,
        };
        ApplyStatus(row);
        CartRows.Add(row);
        Sounds.Play(row.Over ? Sound.BreakLimit : Sound.DigitEntry);
        CartScrollRequested?.Invoke(row);
        if (SequentialMode && parsed.Numbers.Count == 1 && parsed.Numbers[0].All(char.IsDigit))
        {
            var n = int.Parse(parsed.Numbers[0], CultureInfo.InvariantCulture) + 1;
            var mod = (int)Math.Pow(10, bt.Digits);
            NumberText = (n % mod).ToString(new string('0', bt.Digits));
        }
        else NumberText = "";
        if (!UMode) UnitText = "";
        RefreshCart();
        FocusRequested?.Invoke(UMode ? FocusTarget.Number : FocusTarget.Number);
        if (UMode) FocusRequested?.Invoke(FocusTarget.Number);
        else FocusRequested?.Invoke(FocusTarget.Number);
    }

    void ApplyStatus(CartRow row)
    {
        var cap = BreakCap();
        if (cap <= 0) { row.Status = "ကျံ"; row.Over = false; return; }
        var byNum = LedgerRows.ToDictionary(r => r.Number, r => r.UnitValue, StringComparer.Ordinal);
        var over = false;
        foreach (var n in row.NumberList)
        {
            byNum.TryGetValue(n, out var have);
            if (have + row.Unit > cap) over = true;
        }
        row.Over = over;
        row.Status = over ? "ကျွံ" : "ကျံ";
    }

    void RefreshCart()
    {
        OnPropertyChanged(nameof(CartUnits));
        OnPropertyChanged(nameof(CartTotal));
        OnPropertyChanged(nameof(CartCount));
    }

    [RelayCommand]
    async Task CheckoutAsync()
    {
        if (SelectedTerm is null) { Show("အပါတ်စဥ် ရွေးပါ", true); return; }
        if (!IsBuy && SelectedCustomer is null) { Show("Customer နှင့် အပါတ်စဥ် ရွေးပါ", true); return; }
        var lines = CartRows.Where(r => !r.IsChild).ToList();
        if (lines.Count == 0) { Show("ဂဏန်း မထည့်ရသေးပါ", true); return; }
        try
        {
            if (IsBuy)
            {
                var items = lines.SelectMany(l => l.NumberList.Select(n => new PurchaseItem
                {
                    BetTypeId = l.BetTypeId,
                    Number = n,
                    Units = l.Unit,
                })).ToList();
                await _session.Api.PostAsync<object>($"api/terms/{SelectedTerm.Id}/purchases", new PurchaseRequest { Items = items });
            }
            else
            {
                var body = new PlaceTicketRequest
                {
                    TermId = SelectedTerm.Id,
                    UserId = SelectedCustomer!.Id,
                    SaveOver = ExtraSave,
                    Entries = lines.Select(l => new TicketEntry
                    {
                        BetTypeId = l.BetTypeId,
                        Input = l.Input.Length > 12 ? l.Input[..12] : l.Input,
                        Numbers = l.NumberList,
                        Units = l.Unit,
                    }).ToList(),
                };
                await _session.Api.PostAsync<object>("api/tickets", body);
            }
            CartRows.Clear();
            RefreshCart();
            Sounds.Play(Sound.CheckOut);
            Show(IsBuy ? "အဝယ် သိမ်းပြီး" : "Save ပြီး", false);
            await RefreshSlipAndLedgerAsync();
            if (!IsBuy && SelectedCustomer is not null)
                SelectedCustomer = await _session.Api.GetAsync<UserDto>($"api/users/{SelectedCustomer.Id}");
        }
        catch (ApiException ex) { Show(ex.Message, true); }
    }

    [RelayCommand]
    void Hold()
    {
        var lines = CartRows.Where(r => !r.IsChild).ToList();
        if (lines.Count == 0) return;
        HoldTabs.Add(new HoldTab { Title = $"Hold {HoldTabs.Count + 1}", Rows = lines });
        CartRows.Clear();
        RefreshCart();
        OnPropertyChanged(nameof(HasHolds));
    }

    partial void OnSelectedHoldTabChanged(HoldTab? value)
    {
        if (value is null) return;
        CartRows.Clear();
        foreach (var r in value.Rows) CartRows.Add(r);
        HoldTabs.Remove(value);
        RefreshCart();
        OnPropertyChanged(nameof(HasHolds));
    }

    [RelayCommand]
    void RemoveRow(string? rowId)
    {
        var row = CartRows.FirstOrDefault(r => r.RowId == rowId);
        if (row is null || row.IsChild) return;
        for (var i = CartRows.Count - 1; i >= 0; i--)
            if (CartRows[i].ParentRowId == row.RowId || CartRows[i].RowId == row.RowId)
                CartRows.RemoveAt(i);
        Sounds.Play(Sound.Recycle);
        RefreshCart();
    }

    public void RemoveLastRow()
    {
        var row = CartRows.LastOrDefault(r => !r.IsChild);
        if (row is not null) RemoveRow(row.RowId);
    }

    [RelayCommand]
    void Ungroup(string? rowId)
    {
        var row = CartRows.FirstOrDefault(r => r.RowId == rowId);
        if (row is null || row.NumberList.Count < 2) return;
        if (row.Expanded) ToggleExpand(row.RowId);
        var at = CartRows.IndexOf(row);
        CartRows.RemoveAt(at);
        foreach (var n in row.NumberList.AsEnumerable().Reverse())
        {
            CartRows.Insert(at, new CartRow
            {
                BetTypeId = row.BetTypeId,
                Type = row.Type,
                Input = n,
                NumberList = [n],
                Unit = row.Unit,
            });
        }
        RefreshCart();
    }

    [RelayCommand]
    void ToggleExpand(string? rowId)
    {
        var row = CartRows.FirstOrDefault(r => r.RowId == rowId && !r.IsChild);
        if (row is null || row.NumberList.Count < 2) return;
        if (row.Expanded)
        {
            for (var i = CartRows.Count - 1; i >= 0; i--)
                if (CartRows[i].IsChild && CartRows[i].ParentRowId == row.RowId)
                    CartRows.RemoveAt(i);
            row.Expanded = false;
            return;
        }
        var at = CartRows.IndexOf(row);
        for (var i = 0; i < row.NumberList.Count; i++)
        {
            var n = row.NumberList[i];
            CartRows.Insert(at + 1 + i, new CartRow
            {
                BetTypeId = row.BetTypeId,
                Type = row.Type,
                Input = n,
                NumberList = [n],
                Unit = row.Unit,
                IsChild = true,
                ParentRowId = row.RowId,
                Status = row.Status,
                Over = row.Over,
            });
        }
        row.Expanded = true;
    }

    IReadOnlyList<BetTypeDto> TypesForTerm(TermDto term)
    {
        if (term.Game == "2D") return Types.Where(t => t.Digits == 2).ToList();
        if (term.Game == "3D") return Types.Where(t => t.Digits == 3).ToList();
        return Types.ToList();
    }

    [RelayCommand]
    async Task EditTermAsync()
    {
        if (!CanEditTerm || SelectedTerm is null) return;
        if (SelectedTerm.Status is "drawn" or "settled" or "cancelled")
        {
            Show("ဒီအပါတ်စဥ် ဘရိတ် ပြင်လို့ မရတော့ပါ", true);
            return;
        }
        var types = TypesForTerm(SelectedTerm);
        if (types.Count == 0) { Show("Type မရှိပါ", true); return; }
        var owner = Application.Current.Windows.OfType<Window>().FirstOrDefault(w => w.IsActive)
            ?? Application.Current.MainWindow;
        var rows = BreakDialog.Ask(owner, SelectedTerm, types);
        if (rows is null) return;
        try
        {
            await _session.Api.PutAsync<List<TermLimitDto>>($"api/terms/{SelectedTerm.Id}/limits", rows);
            await ApplyTermAsync(SelectedTerm);
            Show("ဘရိတ် သိမ်းပြီး", false);
        }
        catch (ApiException ex) { Show(ex.Message, true); }
    }
    [RelayCommand] void AddCustomer() { }
    [RelayCommand] void ImportLedger() { }
    [RelayCommand] void PasteImport() { }
    [RelayCommand] void PickSendChannel(string? ch) { }
    [RelayCommand] void SortLedger(string? key)
    {
        if (key is not null) LedgerSort = key;
        var rows = LedgerRows.ToList();
        LedgerRows.Clear();
        IEnumerable<LedgerRow> ordered = LedgerSort == "unit"
            ? rows.OrderByDescending(r => r.UnitValue).ThenBy(r => r.Number, StringComparer.Ordinal)
            : rows.OrderBy(r => r.Number, StringComparer.Ordinal);
        foreach (var r in ordered) LedgerRows.Add(r);
    }

    public void ShowCustomerDiscount() { }

    async Task RefreshSlipAndLedgerAsync()
    {
        var view = ViewType();
        if (SelectedTerm is null || view is null)
        {
            SlipBanner = "";
            LedgerRows.Clear();
            return;
        }
        try
        {
            Task<SlipNoDto>? slipTask = null;
            if (SelectedCustomer is not null)
                slipTask = _session.Api.GetAsync<SlipNoDto>(
                    $"api/tickets/next-slip?term_id={SelectedTerm.Id}&user_id={SelectedCustomer.Id}");
            List<ExposureDto> expo = [];
            if (_session.IsUpline)
            {
                var expoTask = _session.Api.GetAsync<List<ExposureDto>>(
                    $"api/terms/{SelectedTerm.Id}/exposure?bet_type_id={view.Id}");
                if (slipTask is not null) await Task.WhenAll(slipTask, expoTask);
                else await expoTask;
                expo = expoTask.Result;
            }
            else if (slipTask is not null) await slipTask;
            SlipBanner = slipTask?.Result.SlipNo ?? "";
            BindLedger(view, expo);
        }
        catch (ApiException ex) { Show(ex.Message, true); }
    }

    void BindLedger(BetTypeDto view, List<ExposureDto> expo)
    {
        var cap = BreakCap(view);
        var d = view.Digits;
        var sold = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var e in expo)
        {
            var num = e.Number.PadLeft(d, '0');
            sold[num] = sold.GetValueOrDefault(num) + e.Units;
        }
        var numbers = LedgerNumbers(view, sold.Keys);
        if (IsBuy)
            numbers = numbers.Where(n =>
            {
                var u = sold.GetValueOrDefault(n);
                return cap > 0 && u > cap;
            }).ToList();
        if (LedgerSort == "unit")
            numbers = numbers.OrderByDescending(n => sold.GetValueOrDefault(n)).ThenBy(n => n, StringComparer.Ordinal).ToList();
        else
            numbers = numbers.OrderBy(n => n, StringComparer.Ordinal).ToList();

        LedgerRows.Clear();
        decimal all = 0, extra = 0;
        foreach (var n in numbers)
        {
            var u = sold.GetValueOrDefault(n);
            var ex = cap > 0 && u > cap ? u - cap : 0;
            all += u;
            extra += ex;
            LedgerRows.Add(new LedgerRow
            {
                Number = n,
                UnitValue = u,
                ExtraValue = ex,
                State = u == 0 ? "empty" : ex > 0 ? "over" : "ok",
            });
        }
        LedgerAll = all.ToString("N0");
        LedgerExtra = extra.ToString("N0");
        LedgerNet = (all - extra).ToString("N0");
        LedgerPct = all == 0 ? "0%" : $"{(extra / all * 100):N0}%";
        OnPropertyChanged(nameof(LedgerAll));
        OnPropertyChanged(nameof(LedgerExtra));
        OnPropertyChanged(nameof(LedgerNet));
        OnPropertyChanged(nameof(LedgerPct));
    }

    static List<string> LedgerNumbers(BetTypeDto view, IEnumerable<string> sold)
    {
        var pad = new string('0', Math.Max(1, view.Digits));
        return view.Digits switch
        {
            2 when view.Code.Contains("TOTO", StringComparison.OrdinalIgnoreCase)
                => Enumerable.Range(1, 49).Select(i => i.ToString("00")).ToList(),
            2 => Enumerable.Range(0, 100).Select(i => i.ToString("00")).ToList(),
            3 => Enumerable.Range(0, 1000).Select(i => i.ToString("000")).ToList(),
            _ => sold.OrderBy(n => n, StringComparer.Ordinal).Select(n => n.PadLeft(pad.Length, '0')).ToList(),
        };
    }

    void Show(string text, bool error)
    {
        Message = text;
        MessageIsError = error;
        if (error) Sounds.Play(Sound.Info);
    }
}
