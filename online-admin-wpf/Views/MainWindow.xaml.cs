using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.ViewModels;

namespace OnlineLotto.Wpf.Views;

public partial class MainWindow : Window
{
    readonly Session _session;
    readonly DispatcherTimer _clock = new() { Interval = TimeSpan.FromSeconds(1) };

    public MainWindow(Session session)
    {
        InitializeComponent();
        _session = session;
        ServerText.Text = session.ServerUrl.Replace("https://", "").Replace("http://", "");
        UserText.Text = $"{session.User.Username}  Logout";
        StatusText.Text = session.Folder is { } f ? $"{session.User.Role} · {f.Name}" : session.User.Role;
        BuyTab.Visibility = session.IsBook ? Visibility.Visible : Visibility.Collapsed;
        ReportsTab.Visibility = session.IsUpline ? Visibility.Visible : Visibility.Collapsed;
        _clock.Tick += (_, _) => ClockText.Text = DateTime.Now.ToString("dd/MM/yyyy hh:mm:ss tt");
        _clock.Start();
        Loaded += OnLoaded;
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.F1) { Tabs.SelectedItem = SaleTab; e.Handled = true; }
        };
        Closed += (_, _) => { _clock.Stop(); Application.Current.Shutdown(); };
    }

    DashboardViewModel? _dash;
    SaleViewModel? _sale;
    SaleViewModel? _buy;
    ReportsViewModel? _reports;

    async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _dash = new DashboardViewModel(_session);
        _dash.SwitchFileRequested += SwitchFile;
        _dash.ToolRequested += OpenTool;
        DashScreen.DataContext = _dash;
        _dash.ShowCachedTerms();
        _sale = new SaleViewModel(_session);
        SaleScreen.Attach(_sale);
        _buy = new SaleViewModel(_session, buy: true);
        BuyScreen.Attach(_buy);
        _reports = new ReportsViewModel(_session);
        ReportsScreen.Attach(_reports);
        _reports.BindTerms();
        var dashLoad = _dash.LoadCommand.ExecuteAsync(null);
        var saleLoad = _sale.LoadAsync();
        var buyLoad = _session.IsBook ? _buy.LoadAsync() : Task.CompletedTask;
        await Task.WhenAll(dashLoad, saleLoad, buyLoad);
    }

    void Tabs_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (!IsLoaded) return;
        if (Tabs.SelectedItem == SaleTab) SaleScreen.FocusCustomerOnShow();
        if (Tabs.SelectedItem == ReportsTab) _reports?.BindTerms();
    }

    async void SwitchFile()
    {
        if (!OpenFileWindow.Ask(this, _session)) return;
        await AfterWorkspaceChangeAsync();
    }

    async Task AfterWorkspaceChangeAsync()
    {
        StatusText.Text = _session.Folder is { } f ? $"{_session.User.Role} · {f.Name}" : _session.User.Role;
        _dash?.ShowCachedTerms();
        _reports?.BindTerms();
        var dashLoad = _dash?.LoadCommand.ExecuteAsync(null) ?? Task.CompletedTask;
        var saleLoad = _sale?.LoadAsync() ?? Task.CompletedTask;
        var buyLoad = _session.IsBook && _buy is not null ? _buy.LoadAsync() : Task.CompletedTask;
        await Task.WhenAll(dashLoad, saleLoad, buyLoad);
    }

    async void OpenTool(string key)
    {
        try
        {
            switch (key)
            {
                case "terms":
                    TermsWindow.ShowList(this, _session);
                    await AfterWorkspaceChangeAsync();
                    break;
                case "bettors":
                    UsersWindow.ShowList(this, _session);
                    break;
                case "commission":
                    CommissionWindow.ShowList(this, _session);
                    break;
                case "winnumbers":
                    WinNumbersWindow.ShowList(this, _session);
                    break;
                case "prizes":
                    PrizeSetsWindow.ShowList(this, _session);
                    break;
                case "newfile":
                    await CreateFolderAsync();
                    break;
                case "settings":
                    SettingsWindow.Show(this, _session);
                    break;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Lotto Admin");
        }
    }

    async Task CreateFolderAsync()
    {
        List<TermTemplateDto> templates = [];
        try { templates = await _session.Api.GetAsync<List<TermTemplateDto>>("api/term-folders/templates"); }
        catch (ApiException) { /* no templates, name-only folder */ }
        var req = NewFolderDialog.Ask(this, templates);
        if (req is null) return;
        var folder = await _session.Api.PostAsync<FolderDto>("api/term-folders",
            req.AutoTerms && req.From is { } from && req.To is { } to
                ? (object)new
                {
                    name = req.Name,
                    date = from.ToString("yyyy-MM-dd"),
                    date_to = to.ToString("yyyy-MM-dd"),
                    tz = UtcOffset(),
                    auto_terms = true,
                }
                : new { name = req.Name, auto_terms = false });
        var terms = await _session.Api.GetAsync<List<TermDto>>($"api/terms?folder_id={folder.Id}");
        _session.OpenFolder(folder, terms);
        await AfterWorkspaceChangeAsync();
        var made = folder.AutoTerms;
        MessageBox.Show(this,
            made > 0 ? $"ဖိုင်ဆောက်ပြီးပါပြီ · အပါတ်စဥ် {made} ခု" : "ဖိုင်ဆောက်ပြီးပါပြီ",
            "Lotto Admin");
    }

    static string UtcOffset()
    {
        var m = (int)DateTimeOffset.Now.Offset.TotalMinutes;
        var sign = m < 0 ? '-' : '+';
        m = Math.Abs(m);
        return $"{sign}{m / 60:00}:{m % 60:00}";
    }

    void LogoutButton_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("Logout လုပ်မလား?", "Lotto Admin", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        var login = new LoginWindow(AppSettings.Load());
        Hide();
        if (login.ShowDialog() == true && login.Session is not null
            && (!login.Session.NeedsFolder || OpenFileWindow.Ask(this, login.Session)))
        {
            var next = new MainWindow(login.Session);
            next.Show();
            Close();
        }
        else Application.Current.Shutdown();
    }
}
