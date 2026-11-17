using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.ViewModels;

public partial class OpenFileViewModel : ObservableObject
{
    readonly Session _session;

    [ObservableProperty] FolderDto? _selected;
    [ObservableProperty] string? _message;
    [ObservableProperty] bool _busy;

    public ObservableCollection<FolderDto> Folders { get; } = [];
    public string WhoText => $"{_session.User.Username} · {_session.User.Role}";

    public OpenFileViewModel(Session session) => _session = session;

    [RelayCommand]
    public async Task LoadAsync()
    {
        Message = null;
        Busy = true;
        try
        {
            var list = await _session.Api.GetAsync<List<FolderDto>>("api/term-folders");
            Folders.Clear();
            foreach (var f in list) Folders.Add(f);
            Selected = Folders.FirstOrDefault();
            if (Folders.Count == 0) Message = "ဖိုင် မရှိသေးပါ — ဝက်ဘ် admin မှာ ဖိုင် ဆောက်ပါ";
        }
        catch (ApiException ex) { Message = ex.Message; }
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
            return true;
        }
        catch (ApiException ex)
        {
            Message = ex.Message;
            return false;
        }
        finally { Busy = false; }
    }
}
