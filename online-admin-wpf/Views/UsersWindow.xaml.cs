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
            var path = _session.IsAgent ? "api/users?role=user" : "api/users";
            var users = await _session.Api.GetAsync<List<UserDto>>(path);
            List.ItemsSource = users.Where(u => u.Status == "active" && (u.Role is "agent" or "user")).ToList();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    UserDto? Selected => List.SelectedItem as UserDto;

    async void New_Click(object sender, RoutedEventArgs e)
    {
        var form = UserFormDialog.AskNew(this, _session);
        if (form is null) return;
        try
        {
            await _session.Api.PostAsync<UserDto>("api/users", new
            {
                username = form.Username,
                password = form.Password,
                name = form.Name,
                role = form.Role,
            });
            await LoadAsync();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    async void Edit_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is not { } user) { ErrorText.Text = "Account ရွေးပါ"; return; }
        var form = UserFormDialog.AskEdit(this, user);
        if (form is null) return;
        try
        {
            await _session.Api.PatchAsync<UserDto>($"api/users/{user.Id}", new { name = form.Name, password = form.Password });
            await LoadAsync();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is not { } user) { ErrorText.Text = "Account ရွေးပါ"; return; }
        if (MessageBox.Show(this, $"{user.Username} ကို Delete လုပ်မလား?", "Account Delete", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;
        try
        {
            // Keep sales and wallet history intact; a deleted account is closed and cannot log in.
            await _session.Api.PatchAsync<UserDto>($"api/users/{user.Id}", new { status = "closed" });
            await LoadAsync();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    async void PrizeAssign_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is not { } user) { ErrorText.Text = "ထိုးသား (User) ရွေးပါ"; return; }
        if (user.Role != "user") { ErrorText.Text = "အလျော်အဆကို ထိုးသား (User) အတွက်သာ တွဲနိုင်သည်"; return; }
        try
        {
            var sets = await _session.Api.GetAsync<List<PrizeSetDto>>("api/prize-sets");
            var set = PrizeAssignDialog.Ask(this, user, sets);
            if (set is null) return;
            await _session.Api.PatchAsync<UserDto>($"api/users/{user.Id}", new { prize_set_id = set.Id });
            await LoadAsync();
        }
        catch (ApiException ex) { ErrorText.Text = ex.Message; }
    }

    void Close_Click(object sender, RoutedEventArgs e) => Close();
}
