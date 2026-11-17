using System.Windows;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public partial class UsersWindow : Window
{
    readonly Session _session;

    public UsersWindow(Session session)
    {
        InitializeComponent();
        _session = session;
        Loaded += async (_, _) => await LoadAsync();
    }

    public static void ShowList(Window? owner, Session session)
    {
        var w = new UsersWindow(session) { Owner = owner };
        w.ShowDialog();
    }

    async Task LoadAsync()
    {
        try
        {
            var role = _session.IsAgent ? "user" : null;
            var path = role is null ? "api/users" : "api/users?role=user";
            List.ItemsSource = await _session.Api.GetAsync<List<UserDto>>(path);
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    void Close_Click(object sender, RoutedEventArgs e) => Close();
}
