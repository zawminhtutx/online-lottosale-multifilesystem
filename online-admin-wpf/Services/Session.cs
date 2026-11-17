namespace OnlineLotto.Wpf.Services;

public sealed class Session
{
    public required ApiClient Api { get; init; }
    public required string Token { get; init; }
    public required UserDto User { get; set; }
    public required string ServerUrl { get; init; }
    public FolderDto? Folder { get; private set; }
    public TermDto? ActiveTerm { get; private set; }
    public List<TermDto> FolderTerms { get; private set; } = [];

    public event Action? WorkspaceChanged;

    public void OpenFolder(FolderDto folder, IReadOnlyList<TermDto> terms)
    {
        Folder = folder;
        FolderTerms = [.. terms];
        ActiveTerm = terms.FirstOrDefault(t => t.Status == "open") ?? terms.FirstOrDefault();
        WorkspaceChanged?.Invoke();
    }

    public void SetActiveTerm(TermDto? term)
    {
        if (ActiveTerm?.Id == term?.Id) return;
        ActiveTerm = term;
        WorkspaceChanged?.Invoke();
    }

    public void ReplaceFolderTerms(IReadOnlyList<TermDto> terms)
    {
        FolderTerms = [.. terms];
        if (ActiveTerm is { } cur)
            ActiveTerm = terms.FirstOrDefault(t => t.Id == cur.Id) ?? ActiveTerm;
        WorkspaceChanged?.Invoke();
    }

    public bool IsAdmin => User.Role == "admin";
    public bool IsBook => User.Role == "master";
    public bool IsMaster => User.Role == "master";
    public bool IsAgent => User.Role == "agent";
    public bool IsUser => User.Role == "user";
    public bool IsUpline => User.Role is "admin" or "master" or "agent";
    public bool NeedsFolder => IsUpline;

    public string TermsPath =>
        IsUser ? "api/terms?status=open"
        : Folder is { } f ? $"api/terms?folder_id={f.Id}"
        : "api/terms";
}
