using System.Windows;
using System.Windows.Threading;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.Views;

namespace OnlineLotto.Wpf;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        Sounds.Enable();
        Sounds.On = AppSettings.Load().SoundsOn;
        var login = new LoginWindow(AppSettings.Load());
        if (login.ShowDialog() != true || login.Session is null)
        {
            Shutdown();
            return;
        }
        // An agent can sign in before its master has created / shared a file.  Do not make that
        // look like an application crash: open the dashboard and let the agent use "ဖိုင်ဖွင့်"
        // once a file is available.
        if (login.Session.NeedsFolder) OpenFileWindow.Ask(null, login.Session);
        var main = new MainWindow(login.Session);
        main.Show();
    }

    void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show(e.Exception.Message, "Lotto Admin error", MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
    }
}
