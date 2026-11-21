using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.ViewModels;

public sealed record ReportType(string Key, string Label)
{
    public override string ToString() => Label;
}

public sealed class LedgerBoardRow
{
    public List<string> Cells { get; init; } = [];
    public bool IsTotal { get; init; }
}

public sealed class LedgerBoardColumn
{
    public string Header { get; init; } = "";
    public double Width { get; init; }
    public bool Right { get; init; }
}

public partial class ReportsViewModel : ObservableObject
{
    readonly Session _session;

    public ObservableCollection<ReportType> ReportTypes { get; } =
    [
        new("summary", "ငွေစာရင်းရှင်းတမ်း"),
        new("ledger", "လယ်ဂျာ"),
        new("payouts", "အလျော်အစားစာရင်း"),
    ];
    public ObservableCollection<TermDto> Terms { get; } = [];
    public ObservableCollection<SummaryRowDto> SummaryRows { get; } = [];
    public ObservableCollection<PayoutRowDto> PayoutRows { get; } = [];
    public ObservableCollection<LedgerBoardRow> BoardRows { get; } = [];
    public List<LedgerBoardColumn> BoardColumns { get; private set; } = [];

    public event Action? BoardChanged;

    [ObservableProperty] ReportType? _selectedReport;
    [ObservableProperty] TermDto? _selectedTerm;
    [ObservableProperty] string _title = "";
    [ObservableProperty] string? _message;
    [ObservableProperty] bool _showSummary = true;
    [ObservableProperty] bool _showLedger;
    [ObservableProperty] bool _showPayout;

    public ReportsViewModel(Session session)
    {
        _session = session;
        SelectedReport = ReportTypes[0];
    }

    public void BindTerms()
    {
        Terms.Clear();
        // Only terms in the currently open file that can be reported on: active, closed, or settled.
        // Draft, drawn and cancelled terms are intentionally not selectable here.
        var folderId = _session.Folder?.Id;
        foreach (var t in _session.FolderTerms.Where(t =>
                     (folderId is null || t.FolderId == folderId)
                     && (t.Status is "open" or "closed" or "settled")))
            Terms.Add(t);
        SelectedTerm = _session.ActiveTerm is { } cur
            ? Terms.FirstOrDefault(t => t.Id == cur.Id)
            : Terms.FirstOrDefault();
    }

    [RelayCommand]
    async Task ViewAsync()
    {
        Message = null;
        if (SelectedTerm is null) { Message = "အပါတ်စဥ် ရွေးပါ"; return; }
        try
        {
            if (SelectedReport?.Key == "ledger")
            {
                ShowSummary = false;
                ShowPayout = false;
                ShowLedger = true;
                var digits = SelectedTerm.Game.Contains('3') ? 3 : 2;
                var meta = await _session.Api.GetAsync<MetaDto>("api/meta");
                var type = meta.BetTypes.FirstOrDefault(b => b.IsActive != 0 && b.Digits == digits);
                var path = type is null
                    ? $"api/terms/{SelectedTerm.Id}/exposure"
                    : $"api/terms/{SelectedTerm.Id}/exposure?bet_type_id={type.Id}";
                var expo = await _session.Api.GetAsync<List<ExposureDto>>(path);
                BuildBoard(digits, expo);
                Title = digits == 3
                    ? $"{SelectedTerm.Description} · ၃လုံး လယ်ဂျာ (000–999)"
                    : $"{SelectedTerm.Description} · ၂လုံး လယ်ဂျာ (00–99)";
            }
            else if (SelectedReport?.Key == "payouts")
            {
                ShowSummary = false;
                ShowLedger = false;
                ShowPayout = true;
                var rows = await _session.Api.GetAsync<List<PayoutRowDto>>($"api/reports/payouts?term_id={SelectedTerm.Id}");
                PayoutRows.Clear();
                foreach (var row in rows) PayoutRows.Add(row);
                Title = $"{SelectedTerm.Description} · အလျော်အစားစာရင်း";
            }
            else
            {
                ShowSummary = true;
                ShowLedger = false;
                ShowPayout = false;
                var rows = await _session.Api.GetAsync<List<SummaryRowDto>>($"api/reports/summary?term_id={SelectedTerm.Id}&group_by=user");
                SummaryRows.Clear();
                foreach (var r in rows) SummaryRows.Add(r);
                Title = $"{SelectedTerm.Description} · ငွေစာရင်းရှင်းတမ်း";
            }
        }
        catch (ApiException ex) { Message = ex.Message; }
    }

    void BuildBoard(int digits, List<ExposureDto> expo)
    {
        var sold = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var e in expo)
        {
            var n = e.Number.PadLeft(digits, '0');
            if (n.Length != digits) continue;
            sold[n] = sold.GetValueOrDefault(n) + e.Units;
        }

        var is3D = digits == 3;
        int[] cols = is3D
            ? Enumerable.Range(0, 10).ToArray()
            : [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
        var rowCount = is3D ? 100 : 10;
        string NumberAt(int c, int i) => is3D ? $"{c}{i:00}" : (c + i).ToString("00");
        string Fmt(decimal u) => u.ToString("N0", CultureInfo.CurrentCulture);

        BoardColumns = cols.SelectMany(_ => new LedgerBoardColumn[]
        {
            new() { Header = "Num", Width = 48 },
            new() { Header = "Unit", Width = 72, Right = true },
        }).ToList();

        BoardRows.Clear();
        decimal pageTotal = 0;
        for (var i = 0; i < rowCount; i++)
        {
            var cells = new List<string>(cols.Length * 2);
            foreach (var c in cols)
            {
                var n = NumberAt(c, i);
                var u = sold.GetValueOrDefault(n);
                pageTotal += u;
                cells.Add(n);
                cells.Add(Fmt(u));
            }
            BoardRows.Add(new LedgerBoardRow { Cells = cells });
        }

        var totalCells = Enumerable.Repeat("", BoardColumns.Count).ToList();
        totalCells[0] = "Total";
        totalCells[^1] = Fmt(pageTotal);
        BoardRows.Add(new LedgerBoardRow { Cells = totalCells, IsTotal = true });
        BoardChanged?.Invoke();
    }

    // Text form used by Dot View (receipt-width) and Report View (page preview).  It is built
    // only from the report that was last loaded with View, so both previews match the screen.
    public string PrintText()
    {
        var lines = new List<string> { Title, new string('-', 56) };
        if (ShowLedger)
        {
            lines.Add(string.Join("  ", BoardColumns.Select(c => c.Header)));
            lines.AddRange(BoardRows.Select(r => string.Join("  ", r.Cells)));
        }
        else if (ShowPayout)
        {
            lines.Add("User         Slip          Type  Number  Unit  Payout");
            lines.AddRange(PayoutRows.Select(r => $"{r.Username,-12} {r.SlipNo,-13} {r.BetType,-5} {r.Number,-7} {r.Units,4:N0}  {r.WinAmount,10:N0}"));
        }
        else if (ShowSummary)
        {
            lines.Add("User         Tickets       Gross         Net      Payout      Profit");
            lines.AddRange(SummaryRows.Select(r => $"{r.Username,-12} {r.Tickets,7:N0} {r.Gross,11:N0} {r.Net,11:N0} {r.Payout,11:N0} {r.Profit,11:N0}"));
        }
        return lines.Count > 2 ? string.Join(Environment.NewLine, lines) : "";
    }

    // POS-style Dot View for a 2D ledger: two consecutive numbers per line, followed by its
    // break/total footer. This is the compact layout used on the receipt printer.
    public string DotText()
    {
        if (!ShowLedger || BoardRows.Count == 0 || BoardRows[0].Cells.Count != 20) return PrintText();

        var amounts = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var row in BoardRows.Where(r => !r.IsTotal))
            for (var i = 0; i + 1 < row.Cells.Count; i += 2)
                if (decimal.TryParse(row.Cells[i + 1], NumberStyles.Number, CultureInfo.CurrentCulture, out var value))
                    amounts[row.Cells[i]] = value;

        var lines = new List<string>
        {
            DateTime.Now.ToString("MM/dd/yyyy, h:mm:ss tt", CultureInfo.GetCultureInfo("en-US")).PadLeft(31),
            (SelectedTerm?.Description ?? "New").PadLeft(22),
            "        ------------------------",
        };
        for (var i = 0; i < 100; i += 2)
        {
            var left = i.ToString("00", CultureInfo.InvariantCulture);
            var right = (i + 1).ToString("00", CultureInfo.InvariantCulture);
            var leftAmount = amounts.GetValueOrDefault(left);
            var rightAmount = amounts.GetValueOrDefault(right);
            lines.Add($"        {left}-{leftAmount,8:N0}|{right}-{rightAmount,8:N0}");
        }
        var total = amounts.Values.Sum();
        var brk = SelectedTerm?.Limits.FirstOrDefault()?.MaxUnits ?? 0;
        var percent = brk <= 0 ? 0 : Math.Round(total * 100m / (brk * 100m), 0);
        lines.Add("        ------------------------");
        lines.Add($"         BREAK-{brk:N0}");
        lines.Add($"         Total-{total:N0}({percent:N0}%)");
        lines.Add("");
        lines.Add("        Page-1");
        return string.Join(Environment.NewLine, lines);
    }
}
