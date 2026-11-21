using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.Views;

namespace OnlineLotto.Wpf.ViewModels;

public partial class OpenFileViewModel : ObservableObject
{
    readonly Session _session;
    readonly AppSettings _settings;

    [ObservableProperty] FolderDto? _selected;
    [ObservableProperty] string? _message;
    [ObservableProperty] bool _busy;

    public ObservableCollection<FolderDto> Folders { get; } = [];
    public ObservableCollection<FolderDto> RecentFolders { get; } = [];
    public string WhoText => $"{_session.User.Username} · {_session.User.Role}";
    public bool CanCreateNew => _session.IsMaster;
    public bool HasRecentFolders => RecentFolders.Count > 0;

    public OpenFileViewModel(Session session)
    {
        _session = session;
        _settings = AppSettings.Load();
    }

    [RelayCommand]
    public async Task LoadAsync()
    {
        Message = null;
        Busy = true;
        try
        {
            var list = await _session.Api.GetAsync<List<FolderDto>>("api/term-folders");
            BindFolders(list);
            if (Folders.Count == 0) Message = CanCreateNew
                ? "ဖိုင် မရှိသေးပါ — Create New ဖြင့် ဖိုင်အသစ် ဆောက်ပါ"
                : "ဖိုင် မရှိသေးပါ — Master မှာ ဖိုင် ဆောက်ပါ";
        }
        catch (Exception ex) { Message = ex.Message; }
        finally { Busy = false; }
    }

    public async Task<bool> OpenAsync()
    {
        if (Selected is null)
        {
            Message = "ဖိုင် ရွေးပါ";
            return false;
        }
        Busy = true;
        Message = null;
        try
        {
            var terms = await _session.Api.GetAsync<List<TermDto>>($"api/terms?folder_id={Selected.Id}");
            _session.OpenFolder(Selected, terms);
            _settings.RememberFolder(_session.ServerUrl, _session.User.Username, Selected);
            return true;
        }
        catch (Exception ex)
        {
            Message = ex.Message;
            return false;
        }
        finally { Busy = false; }
    }

    [RelayCommand]
    public async Task CreateNewAsync()
    {
        if (!CanCreateNew) return;
        try
        {
            var templates = await _session.Api.GetAsync<List<TermTemplateDto>>("api/term-folders/templates");
            var request = NewFolderDialog.Ask(null, templates);
            if (request is null) return;
            var folder = await _session.Api.PostAsync<FolderDto>("api/term-folders",
                request.AutoTerms && request.From is { } from && request.To is { } to
                    ? (object)new
                    {
                        name = request.Name,
                        date = from.ToString("yyyy-MM-dd"),
                        date_to = to.ToString("yyyy-MM-dd"),
                        tz = UtcOffset(),
                        auto_terms = true,
                    }
                    : new { name = request.Name, auto_terms = false });
            var list = await _session.Api.GetAsync<List<FolderDto>>("api/term-folders");
            BindFolders(list, folder.Id);
        }
        catch (ApiException ex) { Message = ex.Message; }
    }

    void BindFolders(IReadOnlyList<FolderDto> list, int? selectId = null)
    {
        Folders.Clear();
        foreach (var folder in list) Folders.Add(folder);

        var byId = list.ToDictionary(x => x.Id);
        RecentFolders.Clear();
        foreach (var recent in _settings.RecentFor(_session.ServerUrl, _session.User.Username))
            if (byId.TryGetValue(recent.FolderId, out var folder)) RecentFolders.Add(folder);
        OnPropertyChanged(nameof(HasRecentFolders));
        Selected = selectId is { } id ? Folders.FirstOrDefault(x => x.Id == id)
            : RecentFolders.FirstOrDefault() ?? Folders.FirstOrDefault();
    }

    static string UtcOffset()
    {
        var minutes = (int)DateTimeOffset.Now.Offset.TotalMinutes;
        var sign = minutes < 0 ? '-' : '+';
        minutes = Math.Abs(minutes);
        return $"{sign}{minutes / 60:00}:{minutes % 60:00}";
    }
}
