using System.Windows;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.ViewModels;

namespace OnlineLotto.Wpf.Views;

public partial class LoginWindow : Window
{
    readonly LoginViewModel _vm;
    public Session? Session => _vm.Session;

    public LoginWindow(AppSettings settings)
    {
        InitializeComponent();
        _vm = new LoginViewModel(settings);
        DataContext = _vm;
        Loaded += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(_vm.Username)) UsernameBox.Focus();
            else PasswordBox.Focus();
        };
    }

    async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        if (_vm.Busy) return;
        _vm.Password = PasswordBox.Password;
        await _vm.SignInCommand.ExecuteAsync(null);
        if (_vm.Session is null) return;
        try { DialogResult = true; }
        catch (InvalidOperationException) { Close(); }
    }
}
