using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.ViewModels;

public sealed record MenuButton(string Key, string Label, string Icon);
public sealed record MenuGroup(string Name, IReadOnlyList<MenuButton> Buttons);

public partial class DashboardViewModel : ObservableObject
{
    readonly Session _session;
    bool _syncing;

    [ObservableProperty] string _title = "Dashboard";
    [ObservableProperty] string _fileName = "ဖိုင် မရွေးရသေးပါ";
    [ObservableProperty] string _agents = "—";
    [ObservableProperty] string _users = "—";
    [ObservableProperty] string _todaySales = "—";
    [ObservableProperty] string _openTerms = "—";
    [ObservableProperty] string? _message;
    [ObservableProperty] TermDto? _selectedTerm;

    public ObservableCollection<SlipCancelDto> DeleteRequests { get; } = [];
    public ObservableCollection<TermDto> Terms { get; } = [];
    public List<MenuGroup> Groups { get; } = [];

    public event Action? SwitchFileRequested;
    public event Action<string>? ToolRequested;

    public bool HasOpenFile => _session.Folder is not null;
    public bool ShowFolder => _session.IsUpline;
    public bool ShowOverview => _session.IsMaster || _session.IsAgent;
    public bool CanModerateDeletes => _session.IsMaster || _session.IsAgent;
    public string FileText => _session.IsUser
        ? "—"
        : _session.Folder?.Name ?? "ဖိုင်ဆောက်ပါ";

    public DashboardViewModel(Session session)
    {
        _session = session;
        BuildMenu();
        _session.WorkspaceChanged += () =>
        {
            FileName = FileText;
            if (_syncing) return;
            var id = _session.ActiveTerm?.Id;
            if (id is null || SelectedTerm?.Id == id) return;
            var match = Terms.FirstOrDefault(t => t.Id == id);
            if (match is null) return;
            _syncing = true;
            SelectedTerm = match;
            _syncing = false;
        };
        FileName = FileText;
    }

    void BuildMenu()
    {
        var book = _session.IsBook;
        var staff = _session.IsMaster || _session.IsAgent;
        (string Group, string Key, string Label, string Icon, bool Show)[] all =
        [
            ("စာရင်း", "terms", "အပါတ်စဥ်", "\uE787", staff),
            ("စာရင်း", "bettors", "ထိုးသား၊ ဒိုင်များ", "\uE716", staff),
            ("စာရင်း", "commission", "ကော်မရှင်", "\uE8EF", staff),
            ("စာရင်း", "winnumbers", "ပေါက်ဂဏန်း", "\uE734", staff),
            ("ဖိုင်", "newfile", "ဖိုင်အသစ်", "\uE8F4", book),
            ("ဖိုင်", "openfile", "ဖိုင်ဖွင့်", "\uE838", staff),
            ("အလျော်", "prizes", "အလျော်အဆ", "\uE8EC", staff),
            ("စီမံခန့်ခွဲ", "settings", "Settings", "\uE713", true),
        ];
        foreach (var g in all.Select(b => b.Group).Distinct())
        {
            var buttons = all.Where(b => b.Group == g && b.Show)
                .Select(b => new MenuButton(b.Key, b.Label, b.Icon)).ToList();
            if (buttons.Count > 0) Groups.Add(new MenuGroup(g, buttons));
        }
    }

    [RelayCommand]
    void SwitchFile() => SwitchFileRequested?.Invoke();

    [RelayCommand]
    async Task PressAsync(MenuButton? button)
    {
        if (button is null) return;
        if (button.Key == "openfile") { SwitchFileRequested?.Invoke(); return; }
        ToolRequested?.Invoke(button.Key);
        await Task.CompletedTask;
    }

    public void ShowCachedTerms()
    {
        FileName = FileText;
        OnPropertyChanged(nameof(FileText));
        OnPropertyChanged(nameof(HasOpenFile));
        BindTerms(_session.FolderTerms);
    }

    void BindTerms(IReadOnlyList<TermDto> terms)
    {
        _syncing = true;
        Terms.Clear();
        foreach (var t in terms.Where(VisibleTerm)) Terms.Add(t);
        var pick = _session.ActiveTerm is { } current
            ? Terms.FirstOrDefault(t => t.Id == current.Id)
            : null;
        pick ??= Terms.FirstOrDefault(t => t.Status == "open") ?? Terms.FirstOrDefault();
        SelectedTerm = pick;
        _syncing = false;
        OpenTerms = Terms.Count(t => t.Status == "open").ToString();
        if (pick is not null) _session.SetActiveTerm(pick);
    }

    bool VisibleTerm(TermDto t) => !_session.IsUser || t.Status == "open";

    [RelayCommand]
    public async Task LoadAsync()
    {
        Message = null;
        ShowCachedTerms();
        try
        {
            var termsTask = _session.FolderTerms.Count > 0 && !_session.IsUser
                ? Task.FromResult(_session.FolderTerms)
                : _session.Api.GetAsync<List<TermDto>>(_session.TermsPath);
            Task<OverviewDto>? overviewTask = ShowOverview
                ? _session.Api.GetAsync<OverviewDto>("api/reports/overview")
                : null;
            Task<List<SlipCancelDto>>? delsTask = CanModerateDeletes
                ? _session.Api.GetAsync<List<SlipCancelDto>>("api/slip-cancel-requests?status=pending")
                : null;

            await termsTask;
            if (overviewTask is not null) await overviewTask;
            if (delsTask is not null) await delsTask;
            var terms = termsTask.Result;
            _session.ReplaceFolderTerms(terms);

            if (overviewTask?.Result is { } overview)
            {
                RoleStatDto Role(string r) => overview.Accounts.FirstOrDefault(a => a.Role == r) ?? new();
                var a = Role("agent");
                var u = Role("user");
                Agents = $"{a.Count} ({a.Active} active)";
                Users = $"{u.Count} ({u.Active} active)";
                TodaySales = $"{overview.Today.Sales:N0} Ks · {overview.Today.Tickets} tickets";
            }
            FileName = FileText;
            BindTerms(terms);

            DeleteRequests.Clear();
            if (delsTask?.Result is { } dels)
                foreach (var d in dels.Take(12)) DeleteRequests.Add(d);
        }
        catch (ApiException ex) { Message = ex.Message; }
        finally { _syncing = false; }
    }

    partial void OnSelectedTermChanged(TermDto? value)
    {
        if (_syncing) return;
        _session.SetActiveTerm(value);
    }

    [RelayCommand]
    async Task ApproveAsync(SlipCancelDto? row)
    {
        if (row is null) return;
        try
        {
            await _session.Api.PostAsync<object>($"api/slip-cancel-requests/{row.Id}/approve");
            DeleteRequests.Remove(row);
        }
        catch (ApiException ex) { Message = ex.Message; }
    }

    [RelayCommand]
    async Task RejectAsync(SlipCancelDto? row)
    {
        if (row is null) return;
        try
        {
            await _session.Api.PostAsync<object>($"api/slip-cancel-requests/{row.Id}/reject");
            DeleteRequests.Remove(row);
        }
        catch (ApiException ex) { Message = ex.Message; }
    }
}
