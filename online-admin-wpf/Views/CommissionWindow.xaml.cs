using System.Windows;
using System.Windows.Input;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public sealed class CommissionRow
{
    public required CommissionUserDto User { get; init; }
    public string Username => User.Username;
    public string Role => User.Role;
    public string Percents { get; set; } = "";
}

public partial class CommissionWindow : Window
{
    readonly Session _session;
    List<BetTypeDto> _types = [];

    public CommissionWindow(Session session)
    {
        InitializeComponent();
        _session = session;
        Loaded += async (_, _) => await LoadAsync();
    }

    public static void ShowList(Window? owner, Session session)
    {
        var w = new CommissionWindow(session) { Owner = owner };
        w.ShowDialog();
    }

    async Task LoadAsync()
    {
        try
        {
            var meta = await _session.Api.GetAsync<MetaDto>("api/meta");
            _types = meta.BetTypes.Where(b => b.IsActive != 0).ToList();
            var users = await _session.Api.GetAsync<List<CommissionUserDto>>("api/users/commissions");
            List.ItemsSource = users.Select(u => new CommissionRow
            {
                User = u,
                Percents = string.Join("   ", _types.Select(bt => $"{bt.Code} {u.Discounts.GetValueOrDefault(bt.Id.ToString()):0.##}")),
            }).ToList();
        }
        catch (ApiException ex) { HintText.Text = ex.Message; HintText.Foreground = (System.Windows.Media.Brush)FindResource("Bad"); }
    }

    async void List_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (List.SelectedItem is not CommissionRow row) return;
        var saves = new List<CommissionSaveRow>();
        foreach (var bt in _types)
        {
            var cur = row.User.Discounts.GetValueOrDefault(bt.Id.ToString()).ToString("0.##");
            var text = InputDialog.Ask(this, $"{row.Username} · {bt.Code}", "ကော်မရှင် %", cur);
            if (text is null) return;
            if (!decimal.TryParse(text, out var n) || n < 0 || n > 100)
            {
                MessageBox.Show(this, "0 မှ 100 ထည့်ပါ", "ကော်မရှင်");
                return;
            }
            saves.Add(new CommissionSaveRow { UserId = row.User.Id, BetTypeId = bt.Id, Discount = n });
        }
        try
        {
            await _session.Api.PutAsync<object>("api/users/commissions", saves);
            await LoadAsync();
        }
        catch (ApiException ex) { HintText.Text = ex.Message; }
    }

    void Close_Click(object sender, RoutedEventArgs e) => Close();
}
