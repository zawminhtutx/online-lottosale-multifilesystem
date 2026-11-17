using System.Windows;
using System.Windows.Input;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public sealed class PrizeRow
{
    public required PrizeSetDto Set { get; init; }
    public string Name => Set.Name;
    public string RatesText { get; init; } = "";
    public string Twod { get; init; } = "0";
    public string Users { get; init; } = "0";
}

public partial class PrizeSetsWindow : Window
{
    readonly Session _session;
    List<BetTypeDto> _types = [];

    public PrizeSetsWindow(Session session)
    {
        InitializeComponent();
        _session = session;
        NewButton.Visibility = session.IsBook ? Visibility.Visible : Visibility.Collapsed;
        Loaded += async (_, _) => await LoadAsync();
    }

    public static void ShowList(Window? owner, Session session)
    {
        var w = new PrizeSetsWindow(session) { Owner = owner };
        w.ShowDialog();
    }

    async Task LoadAsync()
    {
        ErrorText.Text = "";
        try
        {
            var metaTask = _session.Api.GetAsync<MetaDto>("api/meta");
            var setsTask = _session.Api.GetAsync<List<PrizeSetDto>>("api/prize-sets");
            await Task.WhenAll(metaTask, setsTask);
            _types = metaTask.Result.BetTypes.Where(b => b.IsActive != 0).ToList();
            List.ItemsSource = setsTask.Result.Select(s => new PrizeRow
            {
                Set = s,
                RatesText = _types.Count == 0
                    ? "—"
                    : string.Join("    ", _types.Select(bt =>
                    {
                        var m = s.Rates.FirstOrDefault(r => r.BetTypeId == bt.Id)?.Multiplier ?? 0;
                        return $"{bt.Code} ×{m:0.##}";
                    })),
                Twod = s.TwodMultiplier.ToString("0.##"),
                Users = s.UserCount.ToString(),
            }).ToList();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    async void List_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (!_session.IsBook || List.SelectedItem is not PrizeRow row || !row.Set.CanManage) return;
        await EditAsync(row.Set);
    }

    async void New_Click(object sender, RoutedEventArgs e)
    {
        var name = InputDialog.Ask(this, "အလျော်အဆ အသစ်", "အမည်");
        if (name is null) return;
        try
        {
            var copy = (List.ItemsSource as IEnumerable<PrizeRow>)?.FirstOrDefault()?.Set;
            object payload = copy is null ? new { name } : new { name, copy_from = copy.Id };
            var created = await _session.Api.PostAsync<PrizeSetDto>("api/prize-sets", payload);
            await EditAsync(created, isNew: true);
            await LoadAsync();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    async Task EditAsync(PrizeSetDto set, bool isNew = false)
    {
        var values = new List<(BetTypeDto Type, decimal Multiplier, decimal Discount)>();
        foreach (var bt in _types)
        {
            var existing = set.Rates.FirstOrDefault(r => r.BetTypeId == bt.Id);
            var seed = (existing?.Multiplier ?? 0).ToString("0.##");
            var text = InputDialog.Ask(this, $"{set.Name} · {bt.Code}", $"{bt.Description} ×", seed);
            if (text is null) { if (isNew) await LoadAsync(); return; }
            if (!decimal.TryParse(text, out var n) || n < 0)
            {
                MessageBox.Show(this, "0 နှင့်အထက် ထည့်ပါ", "အလျော်အဆ");
                return;
            }
            values.Add((bt, n, existing?.Discount ?? -1));
        }
        var twodText = InputDialog.Ask(this, $"{set.Name} · တွဒ်", "တွဒ် ×", set.TwodMultiplier.ToString("0.##"));
        if (twodText is null) { if (isNew) await LoadAsync(); return; }
        if (!int.TryParse(twodText, out var twod) || twod < 0)
        {
            MessageBox.Show(this, "တွဒ် 0 နှင့်အထက် ထည့်ပါ", "အလျော်အဆ");
            return;
        }
        try
        {
            await _session.Api.PatchAsync<object>($"api/prize-sets/{set.Id}", new { twod_multiplier = twod });
            await _session.Api.PutAsync<object>($"api/prize-sets/{set.Id}/rates",
                values.Select(v => new { bet_type_id = v.Type.Id, multiplier = (int)v.Multiplier, discount = v.Discount }).ToList());
            await LoadAsync();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    void Close_Click(object sender, RoutedEventArgs e) => Close();
}
