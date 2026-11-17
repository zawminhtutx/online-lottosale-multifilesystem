using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.Views;

namespace OnlineLotto.Wpf.ViewModels;

public sealed class TermListRow
{
    public int Id { get; init; }
    public string Description { get; init; } = "";
    public string Game { get; init; } = "";
    public string Status { get; init; } = "";
    public string UnitPrice { get; init; } = "";
    public string ResultText { get; init; } = "";
    public bool CanActivate { get; init; }
    public bool CanClose { get; init; }
}

public partial class TermsWindowViewModel : ObservableObject
{
    readonly Session _session;

    public ObservableCollection<TermListRow> Rows { get; } = [];
    [ObservableProperty] TermListRow? _selected;
    [ObservableProperty] string? _message;
    public bool CanManage => _session.IsBook;

    public TermsWindowViewModel(Session session) => _session = session;

    public async Task LoadAsync()
    {
        Message = null;
        try
        {
            var path = _session.TermsPath;
            var terms = await _session.Api.GetAsync<List<TermDto>>(path);
            _session.ReplaceFolderTerms(terms);
            Rows.Clear();
            foreach (var t in terms)
            {
                var win = t.Results.OrderBy(r => r.Slot).Select(r => r.Value).FirstOrDefault() ?? "";
                Rows.Add(new TermListRow
                {
                    Id = t.Id,
                    Description = t.Description,
                    Game = t.Game,
                    Status = t.Status,
                    UnitPrice = t.UnitPrice.ToString("N0"),
                    ResultText = win,
                    CanActivate = CanManage && t.Status is "draft",
                    CanClose = CanManage && t.Status is "open",
                });
            }
        }
        catch (ApiException ex) { Message = ex.Message; }
    }

    public async Task<bool> CreateAsync(TermFormResult form)
    {
        if (_session.Folder is null) { Message = "ဖိုင် အရင်ဖွင့်ပါ"; return false; }
        try
        {
            await _session.Api.PostAsync<TermDto>("api/terms", new
            {
                description = form.Description,
                game = form.Game,
                unit_price = form.UnitPrice,
                unit_break = form.UnitBreak,
                folder_id = _session.Folder.Id,
                status = "open",
                open_at = form.OpenAt,
                close_at = form.CloseAt,
                draw_at = form.DrawAt,
            });
            await LoadAsync();
            return true;
        }
        catch (ApiException ex) { Message = ex.Message; return false; }
    }

    public async Task SetStatusAsync(int id, string status)
    {
        Message = null;
        try
        {
            await _session.Api.PatchAsync<TermDto>($"api/terms/{id}", new { status });
            await LoadAsync();
        }
        catch (ApiException ex) { Message = ex.Message; }
    }

    public async Task<TermDto?> LoadOneAsync(int id)
    {
        try { return await _session.Api.GetAsync<TermDto>($"api/terms/{id}"); }
        catch (ApiException ex) { Message = ex.Message; return null; }
    }

    public async Task<bool> UpdateAsync(int id, TermFormResult form)
    {
        Message = null;
        try
        {
            await _session.Api.PatchAsync<TermDto>($"api/terms/{id}", new
            {
                description = form.Description,
                game = form.Game,
                unit_price = form.UnitPrice,
                open_at = form.OpenAt,
                close_at = form.CloseAt,
                draw_at = form.DrawAt,
            });
            var meta = await _session.Api.GetAsync<MetaDto>("api/meta");
            var digits = form.Game.Contains('3') ? 3 : 2;
            var rows = meta.BetTypes
                .Where(b => b.IsActive != 0 && b.Digits == digits && form.UnitBreak > 0)
                .Select(b => new TermLimitDto { BetTypeId = b.Id, MaxUnits = form.UnitBreak })
                .ToList();
            await _session.Api.PutAsync<List<TermLimitDto>>($"api/terms/{id}/limits", rows);
            await LoadAsync();
            return true;
        }
        catch (ApiException ex) { Message = ex.Message; return false; }
    }

    public async Task<bool> DeleteAsync(int id)
    {
        Message = null;
        try
        {
            await _session.Api.DeleteAsync<object>($"api/terms/{id}");
            await LoadAsync();
            return true;
        }
        catch (ApiException ex) { Message = ex.Message; return false; }
    }
}
