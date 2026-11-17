using System.Windows;
using System.Windows.Controls;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public sealed class WinRow
{
    public int Id { get; init; }
    public string Description { get; init; } = "";
    public string Game { get; init; } = "";
    public string Status { get; init; } = "";
    public string Number { get; set; } = "";
    public bool CanEdit { get; init; }
}

public partial class WinNumbersWindow : Window
{
    readonly Session _session;

    public WinNumbersWindow(Session session)
    {
        InitializeComponent();
        _session = session;
        if (!_session.IsBook) HintText.Text = "ကြည့်ရုံသာ — ပေါက်ဂဏန်း သိမ်းရန် master လိုသည်";
        Loaded += async (_, _) => await LoadAsync();
    }

    public static void ShowList(Window? owner, Session session)
    {
        var w = new WinNumbersWindow(session) { Owner = owner };
        w.ShowDialog();
    }

    async Task LoadAsync()
    {
        try
        {
            var path = _session.Folder is { } f ? $"api/terms?folder_id={f.Id}" : "api/terms";
            var terms = await _session.Api.GetAsync<List<TermDto>>(path);
            List.ItemsSource = terms.Select(t => new WinRow
            {
                Id = t.Id,
                Description = t.Description,
                Game = t.Game,
                Status = t.Status,
                Number = t.Results.OrderBy(r => r.Slot).Select(r => r.Value).FirstOrDefault() ?? "",
                CanEdit = t.CanManage && t.Status is "open" or "closed" or "drawn" or "settled",
            }).ToList();
        }
        catch (ApiException ex) { HintText.Text = ex.Message; }
    }

    async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: WinRow row }) return;
        var digits = row.Game.Contains('3') ? 3 : 2;
        var value = (row.Number ?? "").Trim();
        if (value.Length != digits || !value.All(char.IsDigit))
        {
            MessageBox.Show(this, $"ပေါက်ဂဏန်း {digits} လုံး ထည့်ပါ", "ပေါက်ဂဏန်း");
            return;
        }
        var slot = digits == 3 ? 1 : 2;
        try
        {
            await _session.Api.PutAsync<object>($"api/terms/{row.Id}/results", new[] { new { slot, value } });
            await LoadAsync();
        }
        catch (ApiException ex) { HintText.Text = ex.Message; }
    }

    void Close_Click(object sender, RoutedEventArgs e) => Close();
}
