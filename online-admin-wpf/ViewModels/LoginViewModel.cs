using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.ViewModels;

public partial class LoginViewModel : ObservableObject
{
    readonly AppSettings _settings;

    [ObservableProperty] string _serverUrl;
    [ObservableProperty] string _username;
    [ObservableProperty] string _password = "";
    [ObservableProperty] string? _error;
    [ObservableProperty] bool _busy;

    public Session? Session { get; private set; }

    public LoginViewModel(AppSettings settings)
    {
        _settings = settings;
        _serverUrl = settings.ServerUrl;
        _username = settings.Username;
    }

    [RelayCommand]
    public async Task SignInAsync()
    {
        Error = null;
        if (string.IsNullOrWhiteSpace(ServerUrl) || string.IsNullOrWhiteSpace(Username) || string.IsNullOrWhiteSpace(Password))
        {
            Error = "Server, Username နှင့် Password ထည့်ပါ";
            return;
        }
        Busy = true;
        try
        {
            var api = new ApiClient(ServerUrl.Trim());
            var res = await api.PostAsync<LoginResponse>("api/auth/login", new { username = Username.Trim(), password = Password });
            if (res.User.Role is not ("admin" or "master" or "agent" or "user"))
            {
                Error = "အကောင့် မှားနေပါသည်";
                api.Dispose();
                return;
            }
            api.SetToken(res.Token);
            _settings.ServerUrl = api.BaseUrl;
            _settings.Username = Username.Trim();
            _settings.Save();
            Session = new Session { Api = api, Token = res.Token, User = res.User, ServerUrl = api.BaseUrl };
        }
        catch (ApiException ex) { Error = ex.Message; }
        catch (Exception)
        {
            // A VPN/proxy can return a non-API page or interrupt TLS before ApiClient can turn it
            // into an ApiException. Keep the login window open and give the operator a retryable
            // message instead of letting the dispatcher close the application.
            Error = "Server ကို ချိတ်ဆက်လို့ မရပါ — internet/VPN နှင့် Server setting ကို စစ်ပါ";
        }
        finally { Busy = false; }
    }
}
