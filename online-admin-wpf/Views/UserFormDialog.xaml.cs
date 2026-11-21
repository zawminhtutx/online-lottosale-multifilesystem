using System.Windows;
using OnlineLotto.Wpf.Services;

namespace OnlineLotto.Wpf.Views;

public sealed record UserFormResult(string? Username, string Name, string? Password, string Role);

public partial class UserFormDialog : Window
{
    bool _editing;
    public UserFormResult? Result { get; private set; }

    public UserFormDialog() => InitializeComponent();

    public static UserFormResult? AskNew(Window owner, Session session)
    {
        var w = new UserFormDialog { Owner = owner };
        w.HeadingText.Text = "Account အသစ်";
        foreach (var role in session.IsMaster ? new[] { "agent", "user" } : new[] { "user" }) w.RoleBox.Items.Add(role);
        w.RoleBox.SelectedIndex = 0;
        w.Loaded += (_, _) => w.UsernameBox.Focus();
        return w.ShowDialog() == true ? w.Result : null;
    }

    public static UserFormResult? AskEdit(Window owner, UserDto user)
    {
        var w = new UserFormDialog { Owner = owner, _editing = true };
        w.HeadingText.Text = "Account ပြင်ရန်";
        w.UsernameBox.Text = user.Username;
        w.UsernameBox.IsReadOnly = true;
        w.NameBox.Text = user.Name ?? "";
        w.RoleBox.Items.Add(user.Role);
        w.RoleBox.SelectedIndex = 0;
        w.RoleBox.IsEnabled = false;
        w.PasswordHint.Text = "မပြောင်းလိုလျှင် ဗလာထားပါ";
        w.Loaded += (_, _) => w.NameBox.Focus();
        return w.ShowDialog() == true ? w.Result : null;
    }

    void Save_Click(object sender, RoutedEventArgs e)
    {
        var username = UsernameBox.Text.Trim();
        var name = NameBox.Text.Trim();
        var password = PasswordBox.Password;
        if (!_editing && (username.Length < 3 || !username.All(c => char.IsLetterOrDigit(c) || c is '_' or '.')))
        { Fail("Username ကို အနည်းဆုံး 3 လုံး (A-Z, 0-9, _ .) ထည့်ပါ"); return; }
        if (name.Length == 0) { Fail("အမည် ထည့်ပါ"); return; }
        if ((!_editing || password.Length > 0) && password.Length < 6) { Fail("Password အနည်းဆုံး 6 လုံး ထည့်ပါ"); return; }
        Result = new UserFormResult(_editing ? null : username, name, password.Length == 0 ? null : password,
            RoleBox.SelectedItem?.ToString() ?? "user");
        DialogResult = true;
    }

    void Fail(string message) { ErrorText.Text = message; ErrorBox.Visibility = Visibility.Visible; }
}
