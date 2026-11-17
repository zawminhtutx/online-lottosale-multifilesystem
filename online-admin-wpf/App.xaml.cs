using System.Windows;
using OnlineLotto.Wpf.Services;
using OnlineLotto.Wpf.Views;

namespace OnlineLotto.Wpf;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Sounds.Enable();
        Sounds.On = AppSettings.Load().SoundsOn;
        var login = new LoginWindow(AppSettings.Load());
        if (login.ShowDialog() != true || login.Session is null)
        {
            Shutdown();
            return;
        }
        if (login.Session.NeedsFolder && !OpenFileWindow.Ask(null, login.Session))
        {
            Shutdown();
            return;
        }
        var main = new MainWindow(login.Session);
        main.Show();
    }
}
