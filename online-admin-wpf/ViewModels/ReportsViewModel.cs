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
    ];
    public ObservableCollection<TermDto> Terms { get; } = [];
    public ObservableCollection<SummaryRowDto> SummaryRows { get; } = [];
    public ObservableCollection<LedgerBoardRow> BoardRows { get; } = [];
    public List<LedgerBoardColumn> BoardColumns { get; private set; } = [];

    public event Action? BoardChanged;

    [ObservableProperty] ReportType? _selectedReport;
    [ObservableProperty] TermDto? _selectedTerm;
    [ObservableProperty] string _title = "";
    [ObservableProperty] string? _message;
    [ObservableProperty] bool _showSummary = true;

    public ReportsViewModel(Session session)
    {
        _session = session;
        SelectedReport = ReportTypes[0];
    }

    public void BindTerms()
    {
        Terms.Clear();
        foreach (var t in _session.FolderTerms) Terms.Add(t);
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
            else
            {
                ShowSummary = true;
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
}
